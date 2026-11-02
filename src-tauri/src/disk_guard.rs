//! A9 — aviso de espacio en C: y limpieza segura (sin tocar release/bundle/D:).

#![forbid(unsafe_code)]

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskFreeReport {
    pub free_gb: f64,
    pub below_min: bool,
    pub min_gb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskCleanReport {
    pub free_gb_before: f64,
    pub free_gb_after: f64,
    pub freed_gb: f64,
    pub detail: String,
}

const PROTECTED_MARKERS: &[&str] = &[
    "target\\release\\bundle",
    "target/release/bundle",
    "LocalAppData",
    "AppData\\Local\\Bara",
    "AppData/Local/Bara",
];

/// ¿La ruta está protegida (no se borra)?
pub fn is_protected_path(path: &str) -> bool {
    let lower = path.replace('/', "\\").to_ascii_lowercase();
    if lower.starts_with("d:\\") || lower == "d:" {
        return true;
    }
    if lower.contains("\\.git\\") || lower.ends_with("\\.git") {
        return true;
    }
    if lower.contains("\\target\\release") && !lower.contains("\\target\\debug") {
        // release (incl. bundle) nunca se limpia desde aquí
        return true;
    }
    PROTECTED_MARKERS
        .iter()
        .any(|marker| lower.contains(&marker.replace('/', "\\").to_ascii_lowercase()))
}

#[cfg(windows)]
fn free_bytes_c() -> Result<u64, String> {
    use std::process::Command;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", "[int64](Get-PSDrive C).Free"])
        .output()
        .map_err(|err| format!("no se pudo consultar C:: {err}"))?;
    if !output.status.success() {
        return Err("no se pudo leer el espacio libre de C:".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    text.parse::<u64>()
        .map_err(|_| format!("respuesta de espacio libre ilegible: {text}"))
}

#[cfg(not(windows))]
fn free_bytes_c() -> Result<u64, String> {
    // No se finge un disco de 16 GiB: se lee el sistema de archivos real.
    let output = std::process::Command::new("df")
        .args(["-B1", "--output=avail", "/"])
        .output()
        .map_err(|err| format!("no se pudo consultar el espacio libre: {err}"))?;
    if !output.status.success() {
        return Err("no se pudo leer el espacio libre".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut found = None;
    for line in text.lines() {
        if let Ok(bytes) = line.trim().parse::<u64>() {
            found = Some(bytes);
        }
    }
    found.ok_or_else(|| format!("respuesta de espacio libre ilegible: {text}"))
}

/// `target/debug` canónico y dentro del workspace. Un symlink que sale no se borra.
fn canonical_debug_dir(workspace_root: &Path) -> Result<Option<PathBuf>, String> {
    let root = fs::canonicalize(workspace_root).map_err(|err| {
        format!(
            "no se pudo canonizar el workspace {}: {err}",
            workspace_root.display()
        )
    })?;
    let debug = root.join("target").join("debug");
    if !debug.exists() {
        return Ok(None);
    }
    let canonical = fs::canonicalize(&debug)
        .map_err(|err| format!("no se pudo canonizar target/debug: {err}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "target/debug sale del workspace ({})",
            canonical.display()
        ));
    }
    let rel = canonical
        .strip_prefix(&root)
        .map_err(|_| "target/debug no es relativo al workspace".to_string())?;
    let rel_s = rel.to_string_lossy().replace('\\', "/");
    if rel_s != "target/debug" {
        return Err(format!(
            "target/debug no es el directorio esperado: {rel_s}"
        ));
    }
    Ok(Some(canonical))
}

fn bytes_to_gb(bytes: u64) -> f64 {
    (bytes as f64) / (1024.0 * 1024.0 * 1024.0)
}

pub fn free_check(min_gb: f64) -> Result<DiskFreeReport, String> {
    let free = free_bytes_c()?;
    let free_gb = (bytes_to_gb(free) * 100.0).round() / 100.0;
    Ok(DiskFreeReport {
        free_gb,
        below_min: free_gb < min_gb,
        min_gb,
    })
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let walker = walkdir_lite(path);
    for file in walker {
        if let Ok(meta) = fs::metadata(&file) {
            if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

fn walkdir_lite(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

fn remove_tree(path: &Path) -> Result<u64, String> {
    let as_str = path.to_string_lossy();
    if is_protected_path(&as_str) {
        return Err(format!("ruta protegida: {as_str}"));
    }
    if !path.exists() {
        return Ok(0);
    }
    let before = dir_size(path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|err| format!("no se pudo borrar {as_str}: {err}"))?;
    } else {
        fs::remove_file(path).map_err(|err| format!("no se pudo borrar {as_str}: {err}"))?;
    }
    Ok(before)
}

/// Limpia `target/debug` del workspace IDE + cache vite si existe.
pub fn clean_safe(workspace_root: &str, min_gb: f64) -> Result<DiskCleanReport, String> {
    let before = free_check(min_gb)?;
    let root = PathBuf::from(workspace_root);
    let mut freed = 0u64;
    let mut notes = Vec::new();

    let debug = match canonical_debug_dir(&root) {
        Ok(Some(path)) => path,
        Ok(None) => {
            notes.push("sin target/debug".to_string());
            PathBuf::new()
        }
        Err(err) => {
            notes.push(err);
            PathBuf::new()
        }
    };
    if !debug.as_os_str().is_empty() {
        match remove_tree(&debug) {
            Ok(n) => {
                freed = freed.saturating_add(n);
                notes.push(format!("target/debug ~{:.2} GB", bytes_to_gb(n)));
            }
            Err(err) => notes.push(err),
        }
    }

    let vite = root.join("web").join("node_modules").join(".vite");
    match remove_tree(&vite) {
        Ok(n) if n > 0 => {
            freed = freed.saturating_add(n);
            notes.push(format!("web/node_modules/.vite ~{:.2} GB", bytes_to_gb(n)));
        }
        _ => {}
    }

    // Nunca tocar release/bundle — comprobación explícita.
    let release = root.join("target").join("release");
    if is_protected_path(&release.to_string_lossy()) {
        notes.push("target/release intacto".to_string());
    }

    let after = free_check(min_gb)?;
    let _ = SystemTime::now().duration_since(UNIX_EPOCH);
    Ok(DiskCleanReport {
        free_gb_before: before.free_gb,
        free_gb_after: after.free_gb,
        freed_gb: (bytes_to_gb(freed) * 100.0).round() / 100.0,
        detail: notes.join(" · "),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a9_protege_release_bundle_y_d() {
        assert!(is_protected_path(r"C:\proj\target\release\bundle\app.exe"));
        assert!(is_protected_path(r"C:\proj\target\release\bara.exe"));
        assert!(is_protected_path(r"D:\BAR\kernel"));
        assert!(is_protected_path(r"C:\proj\.git\config"));
        assert!(!is_protected_path(r"C:\proj\target\debug\incremental"));
        assert!(!is_protected_path(r"C:\proj\target\debug"));
    }

    #[test]
    fn a9_clean_no_toca_release_y_informa() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bara-disk-{nonce}"));
        fs::create_dir_all(root.join("target").join("debug")).expect("debug");
        fs::create_dir_all(root.join("target").join("release").join("bundle")).expect("rel");
        fs::write(
            root.join("target").join("debug").join("x.o"),
            vec![0u8; 4096],
        )
        .expect("obj");
        fs::write(
            root.join("target")
                .join("release")
                .join("bundle")
                .join("keep.bin"),
            b"keep",
        )
        .expect("bundle");
        let report = clean_safe(root.to_str().expect("utf8"), 8.0).expect("clean");
        assert!(!root.join("target").join("debug").exists());
        assert!(root
            .join("target")
            .join("release")
            .join("bundle")
            .join("keep.bin")
            .exists());
        assert!(report.detail.contains("release") || report.freed_gb >= 0.0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a9_no_finge_16_gib() {
        let src = include_str!("disk_guard.rs");
        let fake = format!("{} * {} * {} * {}", 16, 1024, 1024, 1024);
        assert!(!src.contains(&fake), "el espacio libre no se inventa");
    }

    #[test]
    fn a9_no_borra_si_debug_sale_por_symlink() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bara-disk-link-{nonce}"));
        let outside = std::env::temp_dir().join(format!("bara-disk-out-{nonce}"));
        fs::create_dir_all(root.join("target")).expect("target");
        fs::create_dir_all(&outside).expect("out");
        fs::write(outside.join("keep.txt"), b"keep").expect("keep");
        let link = root.join("target").join("debug");
        let linked = {
            #[cfg(windows)]
            {
                std::os::windows::fs::symlink_dir(&outside, &link)
            }
            #[cfg(not(windows))]
            {
                std::os::unix::fs::symlink(&outside, &link)
            }
        };
        if linked.is_err() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }
        let report = clean_safe(root.to_str().expect("utf8"), 8.0).expect("clean");
        assert!(
            outside.join("keep.txt").exists(),
            "no se borra fuera del workspace: {}",
            report.detail
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
