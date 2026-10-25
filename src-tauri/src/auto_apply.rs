//! Veto de Belnap para el modo autónomo.
//!
//! El WebView manda el bloque, la ruta relativa y la línea. El núcleo parsea
//! el bloque y sólo un veredicto `∅` llega a disco. `⊤∧⊥` no escribe.

#![forbid(unsafe_code)]

use bara::autopoietic::BelnapValue;
use bara::log_lattice::status_key;
use bara::syntax;
use bara::transmute_engine::language_of_extension;
use serde::Serialize;

use crate::workspace::{self, WorkspaceDocument};

/// Tope del bloque que se inserta. El archivo completo sigue en 2 MiB.
const MAX_PATCH: usize = 32 * 1024;

const MAX_HOST: usize = 2 * 1024 * 1024;

/// Informe del veto. `source` sólo viaja cuando el parche se escribió.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoApplyReport {
    pub glyph: String,
    pub status: String,
    pub applied: bool,
    pub path: String,
    pub line: u32,
    /// Líneas que ocupó el bloque insertado. Cero si no se escribió.
    pub inserted: u32,
    pub source: String,
}

/// Inserta `patch` en la línea 1-based. `line == 0` añade al final.
fn splice(host: &str, patch: &str, line: u32) -> (String, u32, u32) {
    let patch = patch.trim_matches(|ch: char| ch == '\r' || ch == '\n');
    let patch_lines: Vec<&str> = if patch.is_empty() {
        Vec::new()
    } else {
        patch.split('\n').collect()
    };
    let inserted = u32::try_from(patch_lines.len()).unwrap_or(u32::MAX);
    let ends_nl = host.ends_with('\n');
    let mut lines: Vec<&str> = if host.is_empty() {
        Vec::new()
    } else {
        host.split('\n').collect()
    };
    if ends_nl && lines.last().is_some_and(|row| row.is_empty()) {
        lines.pop();
    }
    let index = if line == 0 {
        lines.len()
    } else {
        (line as usize).saturating_sub(1).min(lines.len())
    };
    for (offset, row) in patch_lines.iter().enumerate() {
        lines.insert(index.saturating_add(offset), row);
    }
    let mut out = lines.join("\n");
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    let at = u32::try_from(index).unwrap_or(0).saturating_add(1);
    (out, at, inserted)
}

fn language_of_path(path: &str) -> bara::transmuter::SourceLanguage {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((_, ext)) => language_of_extension(ext),
        None => language_of_extension(""),
    }
}

/// Juzga y, si el valor es `∅`, escribe el archivo dentro de la raíz activa.
pub fn judge(
    root: &str,
    path: &str,
    line: u32,
    host: &str,
    patch: &str,
) -> Result<AutoApplyReport, String> {
    if path.len() > 512 || line > 1_000_000 {
        return Err("la ruta o la línea quedan fuera de la cota".to_string());
    }
    if patch.len() > MAX_PATCH || host.len() > MAX_HOST {
        return Err("el bloque supera la cota del parche".to_string());
    }
    let value = syntax::judge_patch(language_of_path(path), host, patch);
    let glyph = value.glyph().to_string();
    let status = status_key(value).to_string();
    if value != BelnapValue::Neither {
        return Ok(AutoApplyReport {
            glyph,
            status,
            applied: false,
            path: path.replace('\\', "/"),
            line,
            inserted: 0,
            source: String::new(),
        });
    }
    // El veredicto `∅` usó el host del WebView. Antes de escribir, el archivo
    // canónico de la jaula tiene que ser ese mismo texto, byte a byte.
    let on_disk = workspace::read_text(root, path)?;
    if on_disk.source != host {
        return Err("el archivo en disco no coincide con el editor; no se escribió".to_string());
    }
    let (next, at, inserted) = splice(&on_disk.source, patch, line);
    let document: WorkspaceDocument = workspace::write_source(root, path, &next)?;
    Ok(AutoApplyReport {
        glyph,
        status,
        applied: true,
        path: document.path,
        line: at,
        inserted,
        source: document.source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bara-auto-{nonce}"));
        fs::create_dir_all(dir.join("src")).expect("src");
        dir
    }

    #[test]
    fn el_vacio_escribe_y_el_both_no_toca_el_disco() {
        let root = scratch();
        let file = root.join("src").join("lib.rs");
        fs::write(&file, "fn alpha() {}\n").expect("semilla");
        let root_text = root.display().to_string();
        let clean = judge(
            &root_text,
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn beta() {}\n",
        )
        .expect("limpio");
        assert!(clean.applied);
        assert_eq!(clean.glyph, "∅");
        assert!(clean.source.contains("fn beta()"));
        let clash = judge(
            &root_text,
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn alpha() {}\n",
        )
        .expect("choque");
        assert!(!clash.applied);
        assert_eq!(clash.glyph, "⊤∧⊥");
        let disk = fs::read_to_string(&file).expect("disco");
        assert!(disk.contains("fn beta()"));
        assert_eq!(disk.matches("fn alpha()").count(), 1);
        assert!(judge(&root_text, "../fuera.rs", 1, "", "fn z() {}\n").is_err());
        assert!(judge(&root_text, "src/notas.md", 1, "", "fn z() {}\n").is_err());
    }

    #[test]
    fn el_desequilibrio_no_escribe() {
        let root = scratch();
        fs::write(root.join("src").join("lib.rs"), "fn alpha() {}\n").expect("semilla");
        let report = judge(
            &root.display().to_string(),
            "src/lib.rs",
            1,
            "fn alpha() {}\n",
            "fn gamma() {\n",
        )
        .expect("veto");
        assert!(!report.applied);
        assert_eq!(report.status, "both");
        let disk = fs::read_to_string(root.join("src").join("lib.rs")).expect("disco");
        assert!(!disk.contains("gamma"));
    }

    #[test]
    fn el_host_distinto_no_escribe() {
        let root = scratch();
        let file = root.join("src").join("lib.rs");
        let original = "fn alpha() {}\n";
        fs::write(&file, original).expect("semilla");
        let stale = judge(
            &root.display().to_string(),
            "src/lib.rs",
            2,
            "fn alpha() {}\nfn extra() {}\n",
            "fn beta() {}\n",
        );
        assert!(
            stale.is_err(),
            "un host distinto del disco no puede escribir"
        );
        let message = stale.expect_err("error");
        assert!(
            message.contains("no coincide"),
            "el error no dice que el disco difiere: {message}"
        );
        assert!(!message.contains("⊤∧⊥"));
        let disk = fs::read_to_string(&file).expect("disco");
        assert_eq!(disk, original);
        let fresh = judge(
            &root.display().to_string(),
            "src/lib.rs",
            2,
            original,
            "fn beta() {}\n",
        )
        .expect("host igual");
        assert!(fresh.applied);
        assert!(fs::read_to_string(&file)
            .expect("disco")
            .contains("fn beta()"));
    }
}
