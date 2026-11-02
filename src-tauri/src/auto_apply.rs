//! Veto de Belnap y escritura segura para el modo autónomo.
//!
//! El WebView manda el bloque, la ruta relativa y la línea. El núcleo parsea
//! el bloque con `syntax::judge_patch` (léxico *Shoresh* incluido).
//!
//! Reglas duras:
//! * `judge` **nunca** escribe: sólo devuelve juicio, verificación y diff.
//! * `can_apply` (Auto-Apply) exige `⊤` **verificado**; `∅` / no verificado
//!   nunca escriben solos.
//! * `confirm` (Aceptar a mano) escribe con `⊤` o `∅` (también no verificados);
//!   veto `⊤∧⊥` y `⊥` vacío no escriben. Antes crea `.bara-backup/<fecha_nanos>/`.
//! * `undo` restaura **siempre** desde el respaldo bajo `.bara-backup/` (no hay
//!   deshacer sin ruta de copia).
//! * B4: cada respaldo lleva stamp único (segundos + nanos); se conservan los
//!   últimos [`BACKUP_RETENTION`] por archivo relativo.

#![forbid(unsafe_code)]

use bara::autopoietic::BelnapValue;
use bara::crypto_native::sha256_hex;
use bara::lexer::{Lexer, TokenKind};
use bara::log_lattice::status_key;
use bara::syntax::{self, shoresh_unverified_reason};
use bara::transmute_engine::language_of_extension;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::workspace::{self, WorkspaceDocument};

/// Tope del bloque que se inserta. El archivo completo sigue en 2 MiB.
const MAX_PATCH: usize = 32 * 1024;

/// B4 — cuántos respaldos conservar por archivo relativo bajo `.bara-backup/`.
const BACKUP_RETENTION: usize = 10;

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
    /// Huella del juicio (`line`, host y parche). Vacía si no hubo candidato.
    pub judgment_id: String,
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
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let nanos = duration.subsec_nanos();
    // Fecha UTC compacta a partir del epoch (sin dependencia de calendario).
    let days = secs / 86_400;
    let time = secs % 86_400;
    let hh = time / 3600;
    let mm = (time % 3600) / 60;
    let ss = time % 60;
    // 1970-01-01 + days → YYYYMMDD aproximado civil via algoritmo civil.
    // B4: sufijo de nanos → dos respaldos en el mismo segundo no se pisan.
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}{m:02}{d:02}_{hh:02}{mm:02}{ss:02}_{nanos:09}")
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

/// Copia de seguridad bajo `.bara-backup/` antes de cualquier escritura autónoma.
pub(crate) fn write_backup(root: &str, relative: &str, contents: &str) -> Result<String, String> {
    let root_path = workspace::resolve_root(root)?;
    let stamp = stamp();
    let safe = relative.replace('\\', "/");
    let backup_rel = format!(".bara-backup/{stamp}/{safe}.bak");
    let member = workspace::safe_relative(&backup_rel)?;
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
    prune_backups(&root_path, &safe)?;
    Ok(backup_rel.replace('\\', "/"))
}

/// B4 — conserva los [`BACKUP_RETENTION`] más recientes del mismo relativo.
fn prune_backups(root_path: &Path, safe_relative: &str) -> Result<(), String> {
    let backup_root = root_path.join(".bara-backup");
    if !backup_root.is_dir() {
        return Ok(());
    }
    let mut found = list_backups_for(&backup_root, safe_relative);
    if found.len() <= BACKUP_RETENTION {
        return Ok(());
    }
    // Stamp en el path: orden lexicográfico descendente = más reciente primero.
    found.sort_by(|a, b| b.cmp(a));
    for stale in found.into_iter().skip(BACKUP_RETENTION) {
        let _ = fs::remove_file(&stale);
        if let Some(parent) = stale.parent() {
            let _ = fs::remove_dir(parent); // p.ej. …/stamp/src/
            if let Ok(rel) = parent.strip_prefix(&backup_root) {
                if let Some(stamp_name) = rel.components().next() {
                    let _ = fs::remove_dir(backup_root.join(stamp_name.as_os_str()));
                }
            }
        }
    }
    Ok(())
}

/// Rutas `backup_root/<stamp>/<safe_relative>.bak` existentes.
fn list_backups_for(backup_root: &Path, safe_relative: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(backup_root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let stamp_dir = entry.path();
        if !stamp_dir.is_dir() {
            continue;
        }
        let mut candidate = stamp_dir;
        let parts: Vec<&str> = safe_relative.split('/').filter(|p| !p.is_empty()).collect();
        for (index, part) in parts.iter().enumerate() {
            if index + 1 == parts.len() {
                candidate = candidate.join(format!("{part}.bak"));
            } else {
                candidate = candidate.join(part);
            }
        }
        if candidate.is_file() {
            found.push(candidate);
        }
    }
    found
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

fn is_bara_path(path: &str) -> bool {
    path.rsplit(['/', '\\'])
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .is_some_and(|(_, ext)| ext.eq_ignore_ascii_case("bara"))
}

/// Verificación estricta de parches `.bara`: léxico, sintaxis, raíz conocida y sin identificadores Latin.
fn bara_patch_verified(patch: &str) -> Result<(), String> {
    if let Some(reason) = shoresh_unverified_reason(patch) {
        return Err(reason);
    }
    let tree = syntax::parse(language_of_path("x.bara"), patch);
    if !tree.balanced {
        return Err("propuesta no verificada: sintaxis desequilibrada".to_string());
    }
    let tokens = Lexer::new(patch).tokenize();
    let mut known_roots = 0u32;
    for token in tokens {
        match token.kind {
            TokenKind::Identifier(_) => {
                return Err("propuesta no verificada: identificador ASCII/Latin libre".to_string());
            }
            TokenKind::Root { keyword, .. } if keyword.is_some() => {
                known_roots = known_roots.saturating_add(1);
            }
            _ => {}
        }
    }
    if known_roots == 0 {
        return Err("propuesta no verificada: falta una raíz hebrea conocida".to_string());
    }
    Ok(())
}

fn patch_verified(path: &str, patch: &str) -> (bool, String) {
    if is_bara_path(path) {
        match bara_patch_verified(patch) {
            Ok(()) => (true, String::new()),
            Err(reason) => (false, reason),
        }
    } else {
        // A4/M7: en no-.bara el badge es equilibrado/sin choque (Belnap), no «verificado».
        // `verified=false` evita Auto-Apply ciego; Aceptar manual + backup siguen.
        let tree = syntax::parse(language_of_path(path), patch);
        if !tree.balanced {
            (
                false,
                "propuesta desequilibrada (sin choque no aplica; Aceptar a mano disponible si el juicio lo permite)".to_string(),
            )
        } else {
            (false, String::new())
        }
    }
}

fn judgment_token(line: u32, host: &str, patch: &str) -> String {
    sha256_hex(format!("{line}\0{host}\0{patch}").as_bytes())
}

fn evaluate(path: &str, line: u32, host: &str, patch: &str) -> Result<Verdict, String> {
    if path.len() > 512 || line > 1_000_000 {
        return Err("la ruta o la línea quedan fuera de la cota".to_string());
    }
    if patch.len() > MAX_PATCH || host.len() > MAX_HOST {
        return Err("el bloque supera la cota del parche".to_string());
    }
    let (verified, unverified_reason) = patch_verified(path, patch);
    let value = syntax::judge_patch(language_of_path(path), host, patch);
    let (next, at, _inserted) = splice(host, patch, line);
    // Diff manual siempre que haya texto que empalmar (también ∅ / no verificado).
    // `can_apply` queda sólo para Auto-Apply (⊤ verificado).
    let preview_diff = if patch.trim().is_empty() || value == BelnapValue::False {
        String::new()
    } else {
        unified_diff(path, host, &next)
    };
    let (can_apply, block_reason) = match value {
        BelnapValue::Neither => (
            false,
            if unverified_reason.is_empty() {
                "∅: Auto-Apply bloqueado; puedes Aceptar a mano".to_string()
            } else {
                format!("∅ {unverified_reason} (Auto-Apply bloqueado; puedes Aceptar a mano)")
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
                "propuesta no verificada: Auto-Apply bloqueado; puedes Aceptar a mano".to_string()
            } else {
                format!("{unverified_reason} (Auto-Apply bloqueado; puedes Aceptar a mano)")
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

fn empty_report(
    path: &str,
    line: u32,
    host: &str,
    patch: &str,
    verdict: Verdict,
) -> AutoApplyReport {
    let _ = verdict;
    let token = if patch.trim().is_empty() {
        String::new()
    } else {
        judgment_token(line, host, patch)
    };
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
        judgment_id: token,
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
    // Coherencia con disco: bloquea Auto-Apply pero conserva previewDiff para
    // que el flujo manual (Aceptar/Rechazar) siga visible.
    if verdict.can_apply {
        let on_disk = workspace::read_text(root, path)?;
        if on_disk.source != host {
            verdict.can_apply = false;
            verdict.block_reason =
                "el archivo en disco no coincide con el editor; Auto-Apply bloqueado".to_string();
        }
    }
    let at = verdict.at;
    Ok(empty_report(path, at, host, patch, verdict))
}

/// Escribe el parche tras aceptación explícita. Crea respaldo en `.bara-backup/`.
pub fn confirm(
    root: &str,
    path: &str,
    line: u32,
    host: &str,
    patch: &str,
    judgment_id: &str,
) -> Result<AutoApplyReport, String> {
    if judgment_id.trim().is_empty() {
        return Err("falta el token de juicio; vuelve a abrir el diff".to_string());
    }
    if judgment_id != judgment_token(line, host, patch) {
        return Err("el token de juicio no coincide con la línea, el host o el parche".to_string());
    }
    let mut verdict = evaluate(path, line, host, patch)?;
    // Confirmación manual: escribe con ⊤ o ∅ (también no verificados).
    // Veto ⊤∧⊥ y ⊥ vacío no escriben. `can_apply` sólo gobierna el Auto-Apply.
    if matches!(verdict.value, BelnapValue::Both | BelnapValue::False) || patch.trim().is_empty() {
        if verdict.block_reason.is_empty() {
            verdict.block_reason = "el parche no se puede aplicar".to_string();
        }
        return Ok(empty_report(path, line, host, patch, verdict));
    }
    let on_disk = workspace::read_text(root, path)?;
    if on_disk.source != host {
        return Err("el archivo en disco no coincide con el editor; no se escribió".to_string());
    }
    let backup_path = write_backup(root, path, &on_disk.source)?;
    let (next, at, inserted) = splice(&on_disk.source, patch, line);
    let document: WorkspaceDocument =
        workspace::write_source_checked(root, path, &next, Some(on_disk.content_hash.as_str()))?;
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
        judgment_id: judgment_id.to_string(),
    })
}

/// Restaura el archivo desde un respaldo relativo bajo `.bara-backup/`.
pub fn undo(root: &str, path: &str, backup_path: &str) -> Result<AutoApplyReport, String> {
    if backup_path.trim().is_empty() {
        return Err("deshacer exige la ruta del respaldo en .bara-backup/".to_string());
    }
    if !backup_path.replace('\\', "/").starts_with(".bara-backup/") {
        return Err("el respaldo debe vivir bajo .bara-backup/".to_string());
    }
    let root_path = workspace::resolve_root(root)?;
    let member = workspace::safe_relative(backup_path)?;
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
        judgment_id: String::new(),
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

        let token = preview.judgment_id.clone();
        assert!(!token.is_empty());
        let written = confirm(
            &root_text,
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn beta() {}\n",
            &token,
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
    fn el_vacio_bloquea_auto_pero_confirm_manual_escribe() {
        let root = scratch();
        fs::write(root.join("src").join("lib.rs"), "fn alpha() {}\n").expect("semilla");
        let root_text = root.display().to_string();
        // Raíz hebrea desconocida → ∅ / no verificada: hay diff, sin Auto-Apply.
        let report = judge(&root_text, "src/lib.rs", 1, "fn alpha() {}\n", "זזז\n").expect("∅");
        assert!(!report.applied);
        assert!(!report.can_apply);
        assert_eq!(report.glyph, "∅");
        assert!(!report.verified);
        assert!(
            !report.preview_diff.is_empty(),
            "el flujo manual exige previewDiff"
        );
        let written = confirm(
            &root_text,
            "src/lib.rs",
            1,
            "fn alpha() {}\n",
            "זזז\n",
            &report.judgment_id,
        )
        .expect("confirm manual");
        assert!(written.applied);
        assert!(written.backup_path.starts_with(".bara-backup/"));
        assert!(
            fs::read_to_string(root.join("src").join("lib.rs"))
                .expect("disco")
                .contains("זזז"),
            "Aceptar a mano debe escribir aunque sea ∅"
        );
    }

    #[test]
    fn no_verificado_bara_tiene_diff_y_confirm_manual() {
        let root = scratch();
        fs::write(root.join("doc.bara"), "ברא\n").expect("semilla");
        let root_text = root.display().to_string();
        let report =
            judge(&root_text, "doc.bara", 2, "ברא\n", "vy:+1 * dirección:0\n").expect("juicio");
        assert!(!report.verified);
        assert!(!report.can_apply);
        assert!(
            !report.preview_diff.is_empty(),
            "sin diff el UI no puede mostrar Aceptar/Rechazar"
        );
        let written = confirm(
            &root_text,
            "doc.bara",
            2,
            "ברא\n",
            "vy:+1 * dirección:0\n",
            &report.judgment_id,
        )
        .expect("confirm");
        assert!(written.applied);
        assert!(written.backup_path.starts_with(".bara-backup/"));
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
        let preview = judge(
            &root.display().to_string(),
            "src/lib.rs",
            2,
            "fn alpha() {}\n",
            "fn beta() {}\n",
        )
        .expect("preview");
        let stale = confirm(
            &root.display().to_string(),
            "src/lib.rs",
            2,
            "fn alpha() {}\nfn extra() {}\n",
            "fn beta() {}\n",
            &preview.judgment_id,
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

    #[test]
    fn los_parchest_bara_rechazan_ascii_libre() {
        let root = scratch();
        fs::write(root.join("doc.bara"), "ברא\n").expect("semilla");
        let root_text = root.display().to_string();
        for patch in ["vy:+1 * dirección:0\n", "izquierda ->\n"] {
            let report = judge(&root_text, "doc.bara", 1, "ברא\n", patch).expect("juicio");
            assert!(!report.verified, "debía rechazar «{patch}»");
            assert!(!report.can_apply);
        }
        let ok = judge(&root_text, "doc.bara", 2, "ברא\n", "ברא\n").expect("ok");
        assert!(ok.verified);
    }

    #[test]
    fn confirm_exige_token_de_juicio() {
        let root = scratch();
        fs::write(root.join("doc.bara"), "ברא\n").expect("semilla");
        let root_text = root.display().to_string();
        let err = confirm(&root_text, "doc.bara", 1, "ברא\n", "ברא\n", "").expect_err("token");
        assert!(err.contains("token"));
    }

    #[test]
    fn b4_dos_backups_mismo_segundo_tienen_rutas_distintas() {
        let root = scratch();
        let root_text = root.display().to_string();
        let a = write_backup(&root_text, "src/lib.rs", "uno\n").expect("a");
        let b = write_backup(&root_text, "src/lib.rs", "dos\n").expect("b");
        assert_ne!(a, b, "nanos en el stamp deben distinguir respaldos");
        assert!(a.starts_with(".bara-backup/"));
        assert!(b.starts_with(".bara-backup/"));
        assert!(root.join(&a).is_file());
        assert!(root.join(&b).is_file());
    }

    #[test]
    fn b4_retencion_deja_como_mucho_n_por_archivo() {
        let root = scratch();
        let root_text = root.display().to_string();
        for index in 0..(BACKUP_RETENTION + 3) {
            let body = format!("v{index}\n");
            write_backup(&root_text, "src/lib.rs", &body).expect("backup");
            // Pausa mínima: el stamp usa nanos; en Windows a veces el reloj no avanza.
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let backup_root = root.join(".bara-backup");
        let kept = list_backups_for(&backup_root, "src/lib.rs");
        assert!(
            kept.len() <= BACKUP_RETENTION,
            "quedaron {} respaldos (máx {BACKUP_RETENTION})",
            kept.len()
        );
        assert!(!kept.is_empty());
    }

    #[test]
    fn a4_diff_backup_undo_en_archivo_no_bara() {
        let root = scratch();
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("src/lib.rs"), "fn alpha() {}\n").expect("semilla");
        let root_text = root.display().to_string();
        let host = "fn alpha() {}\n";
        let patch = "fn beta() {}\n";
        let preview = judge(&root_text, "src/lib.rs", 2, host, patch).expect("juicio");
        assert!(!preview.preview_diff.is_empty(), "debe haber previewDiff");
        assert!(!preview.verified, "no-.bara no usa badge verificado");
        assert!(!preview.can_apply, "Auto-Apply ciego bloqueado en no-.bara");
        let written = confirm(
            &root_text,
            "src/lib.rs",
            2,
            host,
            patch,
            &preview.judgment_id,
        )
        .expect("aceptar");
        assert!(written.applied);
        assert!(written.backup_path.starts_with(".bara-backup/"));
        let on_disk = fs::read_to_string(root.join("src/lib.rs")).expect("disco");
        assert!(on_disk.contains("beta"));
        let undone = undo(&root_text, "src/lib.rs", &written.backup_path).expect("deshacer");
        assert!(undone.applied);
        let restored = fs::read_to_string(root.join("src/lib.rs")).expect("restored");
        assert_eq!(restored, host);
    }
}
