//! Veto de Belnap y escritura segura para el modo autónomo.
//!
//! El WebView manda el bloque, la ruta relativa y la línea. El núcleo parsea
//! el bloque con `syntax::judge_patch` (léxico *Shoresh* incluido).
//!
//! Reglas duras:
//! * `judge` **nunca** escribe: sólo devuelve juicio, verificación y diff.
//! * `∅` (Neither) jamás se aplica — ni en automático ni tras aceptar.
//! * `confirm` escribe sólo con `⊤`, léxico verificado y aceptación explícita;
//!   antes crea una copia en `.bara-backup/<fecha>/`.
//! * `undo` restaura ese respaldo.

#![forbid(unsafe_code)]

use bara::autopoietic::BelnapValue;
use bara::log_lattice::status_key;
use bara::syntax::{self, shoresh_unverified_reason};
use bara::transmute_engine::language_of_extension;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    /// `true` si el léxico del kernel reconoce el bloque.
    pub verified: bool,
    /// Motivo de «propuesta no verificada», o vacío.
    pub unverified_reason: String,
    /// Diff unificado (vista previa). Vacío si no hay candidato.
    pub preview_diff: String,
    /// `true` sólo cuando el juicio es `⊤`, está verificado y aún no se escribió.
    pub can_apply: bool,
    /// Aviso legible si no se puede escribir (p. ej. `∅ falta información`).
    pub block_reason: String,
    /// Ruta relativa del respaldo tras un `confirm` exitoso.
    pub backup_path: String,
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

fn stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Fecha UTC compacta a partir del epoch (sin dependencia de calendario).
    let days = secs / 86_400;
    let time = secs % 86_400;
    let hh = time / 3600;
    let mm = (time % 3600) / 60;
    let ss = time % 60;
    // 1970-01-01 + days → YYYYMMDD aproximado civil via algoritmo civil.
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}{m:02}{d:02}_{hh:02}{mm:02}{ss:02}")
}

/// Algoritmo civil de Howard Hinnant (días desde 1970-01-01 → Y-M-D).
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

fn safe_relative(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.trim().is_empty() || path.is_absolute() {
        return Err("la ruta del respaldo debe ser relativa al workspace".to_string());
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "la ruta «{relative}» contiene componentes no permitidos"
        ));
    }
    Ok(path.to_path_buf())
}

fn write_backup(root: &str, relative: &str, contents: &str) -> Result<String, String> {
    let root_path = workspace::resolve_root(root)?;
    let stamp = stamp();
    let safe = relative.replace('\\', "/");
    let backup_rel = format!(".bara-backup/{stamp}/{safe}.bak");
    let member = safe_relative(&backup_rel)?;
    let target = root_path.join(&member);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("no se pudo crear el respaldo: {err}"))?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|err| format!("no se pudo validar el respaldo: {err}"))?;
        if !canonical_parent.starts_with(&root_path) {
            return Err("el respaldo quedaría fuera del workspace".to_string());
        }
    }
    fs::write(&target, contents).map_err(|err| format!("no se pudo guardar el respaldo: {err}"))?;
    Ok(backup_rel.replace('\\', "/"))
}

fn unified_diff(path: &str, before: &str, after: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("--- a/{path}\n+++ b/{path}\n"));
    let left: Vec<&str> = before.split('\n').collect();
    let right: Vec<&str> = after.split('\n').collect();
    let max = left.len().max(right.len());
    for index in 0..max {
        let a = left.get(index).copied().unwrap_or("");
        let b = right.get(index).copied().unwrap_or("");
        if a == b {
            out.push(' ');
            out.push_str(a);
            out.push('\n');
        } else {
            if index < left.len() {
                out.push('-');
                out.push_str(a);
                out.push('\n');
            }
            if index < right.len() {
                out.push('+');
                out.push_str(b);
                out.push('\n');
            }
        }
    }
    out
}

/// Juicio intermedio antes de serializar el informe al WebView.
struct Verdict {
    value: BelnapValue,
    verified: bool,
    unverified_reason: String,
    preview_diff: String,
    at: u32,
    can_apply: bool,
    block_reason: String,
}

fn evaluate(path: &str, line: u32, host: &str, patch: &str) -> Result<Verdict, String> {
    if path.len() > 512 || line > 1_000_000 {
        return Err("la ruta o la línea quedan fuera de la cota".to_string());
    }
    if patch.len() > MAX_PATCH || host.len() > MAX_HOST {
        return Err("el bloque supera la cota del parche".to_string());
    }
    let unverified = shoresh_unverified_reason(patch);
    let verified = unverified.is_none();
    let unverified_reason = unverified.unwrap_or_default();
    let value = syntax::judge_patch(language_of_path(path), host, patch);
    let (next, at, _inserted) = splice(host, patch, line);
    let preview_diff = if value == BelnapValue::True && verified {
        unified_diff(path, host, &next)
    } else {
        String::new()
    };
    let (can_apply, block_reason) = match value {
        BelnapValue::Neither => (
            false,
            if unverified_reason.is_empty() {
                "∅ falta información: no se escribe".to_string()
            } else {
                format!("∅ {unverified_reason}")
            },
        ),
        BelnapValue::Both => (
            false,
            "⊤∧⊥ veto: el bloque contradice el archivo".to_string(),
        ),
        BelnapValue::False => (
            false,
            "⊥ bloque vacío: no hay hecho que escribir".to_string(),
        ),
        BelnapValue::True if !verified => (
            false,
            if unverified_reason.is_empty() {
                "propuesta no verificada: auto-aplicado bloqueado".to_string()
            } else {
                unverified_reason.clone()
            },
        ),
        BelnapValue::True => (true, String::new()),
    };
    Ok(Verdict {
        value,
        verified,
        unverified_reason,
        preview_diff,
        at,
        can_apply,
        block_reason,
    })
}

fn empty_report(path: &str, line: u32, verdict: Verdict) -> AutoApplyReport {
    AutoApplyReport {
        glyph: verdict.value.glyph().to_string(),
        status: status_key(verdict.value).to_string(),
        applied: false,
        path: path.replace('\\', "/"),
        line,
        inserted: 0,
        source: String::new(),
        verified: verdict.verified,
        unverified_reason: verdict.unverified_reason,
        preview_diff: verdict.preview_diff,
        can_apply: verdict.can_apply,
        block_reason: verdict.block_reason,
        backup_path: String::new(),
    }
}

/// Juzga el bloque **sin escribir**. Devuelve diff y si se puede confirmar.
pub fn judge(
    root: &str,
    path: &str,
    line: u32,
    host: &str,
    patch: &str,
) -> Result<AutoApplyReport, String> {
    let mut verdict = evaluate(path, line, host, patch)?;
    // Coherencia con disco: si el host no coincide, no hay candidato aplicable.
    if verdict.can_apply {
        let on_disk = workspace::read_text(root, path)?;
        if on_disk.source != host {
            verdict.can_apply = false;
            verdict.preview_diff.clear();
            verdict.block_reason =
                "el archivo en disco no coincide con el editor; no se escribe".to_string();
            return Ok(empty_report(path, line, verdict));
        }
    }
    let at = verdict.at;
    Ok(empty_report(path, at, verdict))
}

/// Escribe el parche tras aceptación explícita. Crea respaldo en `.bara-backup/`.
pub fn confirm(
    root: &str,
    path: &str,
    line: u32,
    host: &str,
    patch: &str,
) -> Result<AutoApplyReport, String> {
    let mut verdict = evaluate(path, line, host, patch)?;
    if !verdict.can_apply {
        if verdict.block_reason.is_empty() {
            verdict.block_reason = "el parche no se puede aplicar".to_string();
        }
        return Ok(empty_report(path, line, verdict));
    }
    if verdict.value == BelnapValue::Neither {
        verdict.can_apply = false;
        verdict.preview_diff.clear();
        verdict.block_reason = "∅ falta información: no se escribe".to_string();
        return Ok(empty_report(path, line, verdict));
    }
    let on_disk = workspace::read_text(root, path)?;
    if on_disk.source != host {
        return Err("el archivo en disco no coincide con el editor; no se escribió".to_string());
    }
    let backup_path = write_backup(root, path, &on_disk.source)?;
    let (next, at, inserted) = splice(&on_disk.source, patch, line);
    let document: WorkspaceDocument = workspace::write_source(root, path, &next)?;
    Ok(AutoApplyReport {
        glyph: verdict.value.glyph().to_string(),
        status: status_key(verdict.value).to_string(),
        applied: true,
        path: document.path,
        line: at,
        inserted,
        source: document.source,
        verified: verdict.verified,
        unverified_reason: verdict.unverified_reason,
        preview_diff: verdict.preview_diff,
        can_apply: false,
        block_reason: String::new(),
        backup_path,
    })
}

/// Restaura el archivo desde un respaldo relativo bajo `.bara-backup/`.
pub fn undo(root: &str, path: &str, backup_path: &str) -> Result<AutoApplyReport, String> {
    if !backup_path.replace('\\', "/").starts_with(".bara-backup/") {
        return Err("el respaldo debe vivir bajo .bara-backup/".to_string());
    }
    let root_path = workspace::resolve_root(root)?;
    let member = safe_relative(backup_path)?;
    let backup = root_path.join(member);
    let canonical =
        fs::canonicalize(&backup).map_err(|err| format!("no se pudo abrir el respaldo: {err}"))?;
    if !canonical.starts_with(&root_path) {
        return Err("el respaldo queda fuera del workspace".to_string());
    }
    let previous = fs::read_to_string(&canonical)
        .map_err(|err| format!("no se pudo leer el respaldo: {err}"))?;
    let document = workspace::write_source(root, path, &previous)?;
    Ok(AutoApplyReport {
        glyph: "⊤".to_string(),
        status: "true".to_string(),
        applied: true,
        path: document.path,
        line: 1,
        inserted: 0,
        source: document.source,
        verified: true,
        unverified_reason: String::new(),
        preview_diff: String::new(),
        can_apply: false,
        block_reason: String::new(),
        backup_path: backup_path.replace('\\', "/"),
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
    fn el_juicio_no_escribe_y_el_confirm_crea_respaldo() {
        let root = scratch();
        let file = root.join("src").join("lib.rs");
        fs::write(&file, "fn alpha() {}\n").expect("semilla");
        let root_text = root.display().to_string();
        let preview = judge(
            &root_text,
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn beta() {}\n",
        )
        .expect("limpio");
        assert!(!preview.applied);
        assert!(preview.can_apply);
        assert_eq!(preview.glyph, "⊤");
        assert!(preview.verified);
        assert!(!preview.preview_diff.is_empty());
        assert_eq!(fs::read_to_string(&file).expect("disco"), "fn alpha() {}\n");

        let written = confirm(
            &root_text,
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn beta() {}\n",
        )
        .expect("confirm");
        assert!(written.applied);
        assert!(written.backup_path.starts_with(".bara-backup/"));
        assert!(written.source.contains("fn beta()"));
        let disk = fs::read_to_string(&file).expect("disco");
        assert!(disk.contains("fn beta()"));

        let restored = undo(&root_text, "src/lib.rs", &written.backup_path).expect("undo");
        assert!(restored.applied);
        assert_eq!(fs::read_to_string(&file).expect("disco"), "fn alpha() {}\n");
    }

    #[test]
    fn el_vacio_nunca_escribe() {
        let root = scratch();
        fs::write(root.join("src").join("lib.rs"), "fn alpha() {}\n").expect("semilla");
        let root_text = root.display().to_string();
        // Raíz hebrea desconocida → ∅ / no verificada.
        let report = judge(&root_text, "src/lib.rs", 1, "fn alpha() {}\n", "זזז\n").expect("∅");
        assert!(!report.applied);
        assert!(!report.can_apply);
        assert_eq!(report.glyph, "∅");
        assert!(!report.verified);
        let denied = confirm(&root_text, "src/lib.rs", 1, "fn alpha() {}\n", "זזז\n").expect("∅");
        assert!(!denied.applied);
        assert!(!denied.can_apply);
        assert_eq!(
            fs::read_to_string(root.join("src").join("lib.rs")).expect("disco"),
            "fn alpha() {}\n"
        );
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
        assert!(!report.can_apply);
        assert_eq!(report.status, "both");
        let disk = fs::read_to_string(root.join("src").join("lib.rs")).expect("disco");
        assert!(!disk.contains("gamma"));
    }

    #[test]
    fn el_host_distinto_no_confirma() {
        let root = scratch();
        let file = root.join("src").join("lib.rs");
        let original = "fn alpha() {}\n";
        fs::write(&file, original).expect("semilla");
        let stale = confirm(
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
        assert_eq!(fs::read_to_string(&file).expect("disco"), original);
    }
}
