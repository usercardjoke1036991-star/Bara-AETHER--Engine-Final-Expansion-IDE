//! Mapa vivo del workspace (§9.4 / §9.4b): dependencias archivo→archivo,
//! impacto pre-apply, lote atómico con rollback y avisos de desincronía.
//!
//! Se apoya en [`crate::graph`] y en la jaula de [`crate::workspace`]. No abre
//! red ni acepta una raíz elegida por el WebView.

#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::auto_apply;
use crate::graph::{self, WorkspaceTopology};
use crate::workspace;

const MAX_IMPORTS_PER_FILE: usize = 64;
const MAX_BATCH: usize = 24;

/// Arista archivo→archivo (import o llamada cruzada).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDep {
    pub from: String,
    pub to: String,
    pub kind: String,
}

/// Aviso de desincronía.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesyncWarning {
    pub kind: String,
    pub path: String,
    pub detail: String,
}

/// Instantánea del mapa vivo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveMapSnapshot {
    pub files: Vec<String>,
    pub deps: Vec<FileDep>,
    pub warnings: Vec<DesyncWarning>,
    pub truncated: bool,
    pub topology_nodes: usize,
    pub topology_edges: usize,
}

/// Impacto estimado de tocar un conjunto de rutas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReport {
    pub focus: Vec<String>,
    pub files_affected: usize,
    pub tests_affected: usize,
    pub related: Vec<String>,
    pub summary: String,
}

/// Import roto detectado al simular un contenido nuevo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenImport {
    pub path: String,
    pub target: String,
    pub detail: String,
}

/// Puerta pre-apply: impacto + roturas.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeGate {
    pub ok: bool,
    pub impact: ImpactReport,
    pub broken: Vec<BrokenImport>,
    pub block_reason: String,
}

/// Cambio de un lote atómico.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchChange {
    pub path: String,
    pub source: String,
    pub expected_hash: Option<String>,
}

/// Resultado del lote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReport {
    pub applied: bool,
    pub paths: Vec<String>,
    pub backups: Vec<String>,
    pub rolled_back: bool,
    pub detail: String,
}

/// Subgrafo textual para el prompt de la IA.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapContext {
    pub focus: Vec<String>,
    pub text: String,
    pub files: usize,
    pub deps: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum ImportKind {
    /// `mod foo;` / `pub mod foo;` → archivo.
    FileMod,
    /// `use` / `import` / `from` / `require`.
    PathRef,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct RawImport {
    target: String,
    kind: ImportKind,
}

/// Construye el mapa vivo de la carpeta activa.
pub fn snapshot(root: &str) -> Result<LiveMapSnapshot, String> {
    let topology = graph::build(root)?;
    let mut files: BTreeSet<String> = BTreeSet::new();
    for node in &topology.nodes {
        if node.kind == "file" {
            files.insert(node.path.replace('\\', "/"));
        }
    }
    let file_list: Vec<String> = files.iter().cloned().collect();
    let mut deps = file_deps_from_topology(&topology);
    let mut import_deps = Vec::new();
    for path in &file_list {
        if let Ok(doc) = workspace::read_text(root, path) {
            for raw in extract_imports(path, &doc.source) {
                if path.ends_with(".py") && is_python_stdlib(&raw.target) {
                    continue;
                }
                if let Some(resolved) = resolve_import_target(&files, &raw.target) {
                    import_deps.push(FileDep {
                        from: path.clone(),
                        to: resolved,
                        kind: "import".to_string(),
                    });
                }
            }
        }
    }
    deps.append(&mut import_deps);
    dedupe_deps(&mut deps);

    let warnings = desync_warnings(root, &file_list, &deps, &topology);
    Ok(LiveMapSnapshot {
        truncated: topology.truncated,
        topology_nodes: topology.nodes.len(),
        topology_edges: topology.edges.len(),
        files: file_list,
        deps,
        warnings,
    })
}

/// Impacto de tocar `focus` (rutas relativas).
pub fn impact(root: &str, focus: &[String]) -> Result<ImpactReport, String> {
    let map = snapshot(root)?;
    let focus: Vec<String> = focus
        .iter()
        .map(|p| p.replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();
    let mut related: BTreeSet<String> = focus.iter().cloned().collect();
    for _ in 0..3 {
        let mut grow = Vec::new();
        for dep in &map.deps {
            if related.contains(&dep.from) {
                grow.push(dep.to.clone());
            }
            if related.contains(&dep.to) {
                grow.push(dep.from.clone());
            }
        }
        related.extend(grow);
    }
    let related_list: Vec<String> = related.into_iter().collect();
    let tests_affected = related_list.iter().filter(|p| is_test_path(p)).count();
    let files_affected = related_list.len();
    let summary = format!("afecta a {files_affected} archivo(s) y {tests_affected} test(s)");
    Ok(ImpactReport {
        focus,
        files_affected,
        tests_affected,
        related: related_list,
        summary,
    })
}

/// Evalúa un cambio propuesto **antes** de escribir.
///
/// Solo peina imports **nuevos o cambiados** respecto al host en disco.
pub fn gate_change(root: &str, path: &str, next_source: &str) -> Result<ChangeGate, String> {
    let path = path.replace('\\', "/");
    let impact = impact(root, std::slice::from_ref(&path))?;
    let map = snapshot(root)?;
    let files: BTreeSet<String> = map.files.iter().cloned().collect();
    let mut broken = Vec::new();

    let host = workspace::read_text(root, &path)
        .map(|doc| doc.source)
        .unwrap_or_default();
    let host_imports: BTreeSet<RawImport> = extract_imports(&path, &host).into_iter().collect();
    let next_imports = extract_imports(&path, next_source);

    for raw in next_imports {
        if host_imports.contains(&raw) {
            continue;
        }
        if let Some(target) = python_unresolved_edge(&path, &files, &raw) {
            broken.push(BrokenImport {
                path: path.clone(),
                target,
                detail: format!("import «{}» no resuelve a un archivo del mapa", raw.target),
            });
            continue;
        }
        if python_bare_is_external(&path, &files, &raw) {
            continue;
        }
        if !should_gate_as_project(&path, &raw) {
            continue;
        }
        if resolve_import_target(&files, &raw.target).is_none() {
            broken.push(BrokenImport {
                path: path.clone(),
                target: raw.target.clone(),
                detail: format!("import «{}» no resuelve a un archivo del mapa", raw.target),
            });
        }
    }

    // Archivo vacío con dependientes → rotura (ruta con extensión incluida).
    if next_source.trim().is_empty() {
        let stem = file_stem(&path);
        for dep in &map.deps {
            if dep_targets_path(dep, &path, &stem) {
                broken.push(BrokenImport {
                    path: dep.from.clone(),
                    target: path.clone(),
                    detail: format!(
                        "«{}» depende de «{path}» y el cambio dejaría el archivo vacío",
                        dep.from
                    ),
                });
            }
        }
    }

    let ok = broken.is_empty();
    let block_reason = if ok {
        String::new()
    } else {
        format!(
            "el cambio rompería {} import(s) antes de escribirse",
            broken.len()
        )
    };
    Ok(ChangeGate {
        ok,
        impact,
        broken,
        block_reason,
    })
}

/// Aplica varios archivos: todo o nada, con backup + rollback.
///
/// §9.4b: si un archivo no existía antes, el rollback lo borra (papelera jaula).
/// `rolled_back` sólo es true si restore/borrado tuvo éxito.
pub fn apply_batch(root: &str, changes: &[BatchChange]) -> Result<BatchReport, String> {
    if changes.is_empty() {
        return Ok(BatchReport {
            applied: false,
            paths: Vec::new(),
            backups: Vec::new(),
            rolled_back: false,
            detail: "lote vacío".to_string(),
        });
    }
    if changes.len() > MAX_BATCH {
        return Err(format!("el lote supera {MAX_BATCH} archivos"));
    }
    for change in changes {
        let gate = gate_change(root, &change.path, &change.source)?;
        if !gate.ok {
            return Ok(BatchReport {
                applied: false,
                paths: changes.iter().map(|c| c.path.clone()).collect(),
                backups: Vec::new(),
                rolled_back: false,
                detail: gate.block_reason,
            });
        }
    }

    let mut backups = Vec::new();
    // (path, prior_source_if_existed)
    let mut previous: Vec<(String, Option<String>)> = Vec::new();
    for change in changes {
        let path = change.path.replace('\\', "/");
        let prior = match workspace::read_text(root, &path) {
            Ok(doc) => Some(doc.source),
            Err(_) => None,
        };
        let backup_body = prior.clone().unwrap_or_default();
        let backup = auto_apply::write_backup(root, &path, &backup_body)?;
        backups.push(backup);
        previous.push((path, prior));
    }

    let mut written = 0usize;
    for (index, change) in changes.iter().enumerate() {
        let path = change.path.replace('\\', "/");
        let expected = change.expected_hash.clone().or_else(|| {
            previous
                .get(index)
                .and_then(|(_, src)| src.as_ref().map(|s| workspace::content_hash(s)))
        });
        // Archivo nuevo: expected None (no hay huella previa).
        let expected_ref = if previous.get(index).and_then(|(_, p)| p.as_ref()).is_none() {
            None
        } else {
            expected.as_deref()
        };
        if let Err(err) = workspace::write_source_checked(root, &path, &change.source, expected_ref)
        {
            let (rolled_back, rb_detail) = rollback_written(root, &previous, written);
            return Ok(BatchReport {
                applied: false,
                paths: changes.iter().map(|c| c.path.replace('\\', "/")).collect(),
                backups,
                rolled_back,
                detail: format!("falló «{path}»: {err}; {rb_detail}"),
            });
        }
        written += 1;
    }

    Ok(BatchReport {
        applied: true,
        paths: changes.iter().map(|c| c.path.replace('\\', "/")).collect(),
        backups,
        rolled_back: false,
        detail: format!("aplicados {written} archivo(s)"),
    })
}

fn rollback_written(
    root: &str,
    previous: &[(String, Option<String>)],
    written: usize,
) -> (bool, String) {
    let mut errors = Vec::new();
    for (prev_path, prior) in previous.iter().take(written).rev() {
        match prior {
            Some(src) => {
                if let Err(err) = workspace::write_source(root, prev_path, src) {
                    errors.push(format!("restore «{prev_path}»: {err}"));
                }
            }
            None => {
                if let Err(err) = workspace::delete_entry(root, prev_path) {
                    errors.push(format!("borrar nuevo «{prev_path}»: {err}"));
                }
            }
        }
    }
    if errors.is_empty() {
        (true, "rollback completo".to_string())
    } else {
        (false, format!("rollback incompleto: {}", errors.join("; ")))
    }
}

/// Submapa relevante a `focus` para el prompt (acotado).
pub fn context_for(root: &str, focus: &[String], max_lines: usize) -> Result<MapContext, String> {
    let impact = impact(root, focus)?;
    let map = snapshot(root)?;
    let related: BTreeSet<String> = impact.related.iter().cloned().collect();
    let mut lines = Vec::new();
    lines.push(format!("## Mapa vivo (subgrafo) · {}", impact.summary));
    let mut dep_count = 0usize;
    for dep in &map.deps {
        if related.contains(&dep.from) || related.contains(&dep.to) {
            lines.push(format!("- {} → {} ({})", dep.from, dep.to, dep.kind));
            dep_count += 1;
            if lines.len() >= max_lines.saturating_sub(4) {
                lines.push("- …".to_string());
                break;
            }
        }
    }
    for warn in map
        .warnings
        .iter()
        .filter(|w| related.contains(&w.path))
        .take(8)
    {
        lines.push(format!("! {} · {} · {}", warn.kind, warn.path, warn.detail));
    }
    Ok(MapContext {
        focus: impact.focus,
        files: related.len(),
        deps: dep_count,
        text: lines.join("\n"),
    })
}

fn file_deps_from_topology(topology: &WorkspaceTopology) -> Vec<FileDep> {
    let id_to_path: BTreeMap<&str, &str> = topology
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.path.as_str()))
        .collect();
    let mut deps = Vec::new();
    for edge in &topology.edges {
        let Some(from) = id_to_path.get(edge.source.as_str()) else {
            continue;
        };
        let Some(to) = id_to_path.get(edge.target.as_str()) else {
            continue;
        };
        if from == to {
            continue;
        }
        let from_file = topology
            .nodes
            .iter()
            .find(|n| n.id == edge.source)
            .map(|n| n.path.as_str())
            .unwrap_or(from);
        let to_file = topology
            .nodes
            .iter()
            .find(|n| n.id == edge.target)
            .map(|n| n.path.as_str())
            .unwrap_or(to);
        if from_file != to_file {
            deps.push(FileDep {
                from: from_file.replace('\\', "/"),
                to: to_file.replace('\\', "/"),
                kind: "call".to_string(),
            });
        }
    }
    deps
}

fn desync_warnings(
    root: &str,
    files: &[String],
    deps: &[FileDep],
    topology: &WorkspaceTopology,
) -> Vec<DesyncWarning> {
    let mut warnings = Vec::new();
    let file_set: BTreeSet<String> = files.iter().cloned().collect();
    let mut inbound: BTreeSet<&str> = BTreeSet::new();
    let mut outbound: BTreeSet<&str> = BTreeSet::new();
    for dep in deps {
        inbound.insert(dep.to.as_str());
        outbound.insert(dep.from.as_str());
    }
    for path in files {
        if !inbound.contains(path.as_str())
            && !outbound.contains(path.as_str())
            && !is_test_path(path)
        {
            warnings.push(DesyncWarning {
                kind: "isolated".to_string(),
                path: path.clone(),
                detail: "archivo aislado: sin aristas de import/llamada en el mapa".to_string(),
            });
        }
        if let Ok(doc) = workspace::read_text(root, path) {
            for raw in extract_imports(path, &doc.source) {
                if should_gate_as_project(path, &raw)
                    && resolve_import_target(&file_set, &raw.target).is_none()
                {
                    warnings.push(DesyncWarning {
                        kind: "broken_import".to_string(),
                        path: path.clone(),
                        detail: format!("import «{}» sin destino en el workspace", raw.target),
                    });
                }
            }
        }
    }
    let mut called: BTreeSet<&str> = BTreeSet::new();
    for edge in &topology.edges {
        called.insert(edge.target.as_str());
    }
    for node in topology.nodes.iter().filter(|n| n.kind == "function") {
        if !called.contains(node.id.as_str())
            && !node.label.starts_with("test_")
            && node.label != "main"
        {
            warnings.push(DesyncWarning {
                kind: "dead".to_string(),
                path: node.path.clone(),
                detail: format!(
                    "función «{}» sin referencias entrantes en el mapa",
                    node.label
                ),
            });
        }
    }
    warnings.truncate(80);
    warnings
}

fn extract_imports(path: &str, source: &str) -> Vec<RawImport> {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mut out = Vec::new();
    match ext.as_str() {
        "rs" => extract_rust_imports(source, &mut out),
        "ts" | "tsx" | "js" | "jsx" => extract_js_imports(source, &mut out),
        "py" => extract_py_imports(source, &mut out),
        _ => {}
    }
    out.truncate(MAX_IMPORTS_PER_FILE);
    out
}

fn extract_rust_imports(source: &str, out: &mut Vec<RawImport>) {
    for line in source.lines() {
        let trimmed = line.trim_start();
        let (rest, kind) = if let Some(r) = strip_vis_prefix(trimmed, "use ") {
            (r, ImportKind::PathRef)
        } else if let Some(r) = strip_vis_prefix(trimmed, "mod ") {
            (r, ImportKind::FileMod)
        } else {
            continue;
        };
        if kind == ImportKind::FileMod {
            // Solo `mod nombre;` / `pub mod nombre;` (archivo). Inline `mod nombre {` se ignora.
            let name_end = rest
                .find(|c: char| c == ';' || c == '{' || c.is_whitespace())
                .unwrap_or(rest.len());
            let name = rest[..name_end].trim();
            let after = rest[name_end..].trim_start();
            if name.is_empty() || !after.starts_with(';') {
                continue;
            }
            if is_ignored_rust_glob(name) {
                continue;
            }
            out.push(RawImport {
                target: name.to_string(),
                kind,
            });
            continue;
        }
        // use / pub use
        let token = rest
            .split(|c: char| c == ';' || c == '{' || c.is_whitespace())
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches("::");
        if token.is_empty() {
            continue;
        }
        let full_to_semi = rest.split(';').next().unwrap_or(rest).trim();
        if full_to_semi.contains("::*") || token.ends_with('*') {
            let glob_path = full_to_semi
                .split("::*")
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches("::");
            // `super::*` / `self::*` / `crate::*` no son un archivo.
            // `use crate::ruta::*` sí: tiene que resolver.
            if glob_path.starts_with("crate::") {
                out.push(RawImport {
                    target: glob_path.to_string(),
                    kind,
                });
            }
            continue;
        }
        if is_ignored_rust_glob(token) {
            continue;
        }
        out.push(RawImport {
            target: token.to_string(),
            kind,
        });
    }
}

fn strip_vis_prefix<'a>(trimmed: &'a str, kw: &str) -> Option<&'a str> {
    let body = trimmed
        .strip_prefix("pub(crate) ")
        .or_else(|| trimmed.strip_prefix("pub(super) "))
        .or_else(|| trimmed.strip_prefix("pub "))
        .unwrap_or(trimmed);
    body.strip_prefix(kw)
}

fn is_ignored_rust_glob(token: &str) -> bool {
    matches!(token, "super::*" | "self::*" | "*")
        || token == "super"
        || token == "self"
        || token.ends_with("::*")
}

fn extract_js_imports(source: &str, out: &mut Vec<RawImport>) {
    for line in source.lines() {
        let trimmed = line.trim_start();
        // import … from '…'  |  export … from '…'
        let is_import_export = trimmed.starts_with("import ")
            || trimmed.starts_with("export ")
            || trimmed.starts_with("export{")
            || trimmed.starts_with("export {");
        if is_import_export {
            if let Some(idx) = find_from_keyword(trimmed) {
                let after_from = trimmed[idx + 4..].trim_start();
                if let Some(spec) = quoted_string(after_from) {
                    out.push(RawImport {
                        target: spec,
                        kind: ImportKind::PathRef,
                    });
                }
            }
        }
        // require('…')
        if let Some(idx) = trimmed.find("require(") {
            let after = trimmed[idx + "require(".len()..].trim_start();
            if let Some(spec) = quoted_string(after) {
                out.push(RawImport {
                    target: spec,
                    kind: ImportKind::PathRef,
                });
            }
        }
    }
}

/// Localiza ` from ` como palabra clave (no `Array.from`).
fn find_from_keyword(line: &str) -> Option<usize> {
    let lower = line.to_ascii_lowercase();
    let mut search = lower.as_str();
    let mut base = 0usize;
    while let Some(rel) = search.find("from") {
        let abs = base + rel;
        let before_ok = abs == 0
            || line
                .as_bytes()
                .get(abs - 1)
                .is_some_and(|b| b.is_ascii_whitespace() || *b == b'}');
        let after = abs + 4;
        let after_ok = line
            .as_bytes()
            .get(after)
            .is_some_and(|b| b.is_ascii_whitespace() || *b == b'\'' || *b == b'"');
        if before_ok && after_ok {
            return Some(abs);
        }
        base = abs + 4;
        search = &lower[base..];
    }
    None
}

fn quoted_string(s: &str) -> Option<String> {
    let s = s.trim_start();
    let q = s.chars().next().filter(|c| *c == '\'' || *c == '"')?;
    let body = &s[1..];
    let end = body.find(q)?;
    Some(body[..end].to_string())
}

fn extract_py_imports(source: &str, out: &mut Vec<RawImport>) {
    for line in source.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("from ") {
            let token = rest.split_whitespace().next().unwrap_or("").trim();
            if !token.is_empty() {
                out.push(RawImport {
                    target: token.to_string(),
                    kind: ImportKind::PathRef,
                });
            }
        } else if let Some(rest) = trimmed.strip_prefix("import ") {
            let code = rest.split('#').next().unwrap_or(rest);
            for part in code.split(',') {
                let token = part.split_whitespace().next().unwrap_or("").trim();
                if token.is_empty() {
                    continue;
                }
                out.push(RawImport {
                    target: token.to_string(),
                    kind: ImportKind::PathRef,
                });
            }
        }
    }
}

fn is_py_file(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .unwrap_or("")
        .eq_ignore_ascii_case("py")
}

/// Bare de Python (no relativo, no stdlib). `None` si no aplica.
fn python_bare_name(raw: &RawImport) -> Option<&str> {
    let name = raw.target.as_str();
    if name.is_empty() || name.starts_with('.') || name.contains('/') || is_python_stdlib(name) {
        return None;
    }
    Some(name)
}

/// Bare que es arista (su raíz está en el mapa) y el target completo no resuelve.
fn python_unresolved_edge(path: &str, files: &BTreeSet<String>, raw: &RawImport) -> Option<String> {
    if !is_py_file(path) {
        return None;
    }
    let name = python_bare_name(raw)?;
    if resolve_import_target(files, name).is_some() {
        return None;
    }
    let top = name.split('.').next().unwrap_or(name);
    if resolve_import_target(files, top).is_some() {
        Some(name.to_string())
    } else {
        None
    }
}

/// Bare ya resuelto, o paquete que no es arista del mapa: no entra al gate relativo.
fn python_bare_is_external(path: &str, files: &BTreeSet<String>, raw: &RawImport) -> bool {
    if !is_py_file(path) {
        return false;
    }
    let Some(name) = python_bare_name(raw) else {
        return false;
    };
    let top = name.split('.').next().unwrap_or(name);
    resolve_import_target(files, name).is_some() || resolve_import_target(files, top).is_none()
}

/// ¿Debe el gate/avisos exigir resolución a archivo del mapa?
fn should_gate_as_project(path: &str, raw: &RawImport) -> bool {
    let t = raw.target.as_str();
    if t.is_empty() || is_ignored_rust_glob(t) {
        return false;
    }
    // Scoped npm / Tauri.
    if t.starts_with('@') {
        return false;
    }
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "rs" => match raw.kind {
            ImportKind::FileMod => true,
            ImportKind::PathRef => {
                if t.starts_with("std::") || t.starts_with("core::") || t.starts_with("alloc::") {
                    return false;
                }
                // Relativos / crate:: / super:: / self:: (no glob ya filtrado).
                t.starts_with("crate::")
                    || t.starts_with("super::")
                    || t.starts_with("self::")
                    || t.starts_with('/')
                    || t.contains('/')
                // Identificador simple (`anyhow`, `serde`) → externo.
            }
        },
        "ts" | "tsx" | "js" | "jsx" => !is_external_js_specifier(t),
        "py" => {
            if is_python_stdlib(t) {
                return false;
            }
            // Relativo siempre. El bare lo decide `python_unresolved_edge`:
            // arista del mapa que no resuelve → bloqueo; paquete externo no.
            t.starts_with('.') || t.contains('/')
        }
        _ => t.starts_with('.') || t.starts_with('/') || t.starts_with("crate::"),
    }
}

fn is_python_stdlib(name: &str) -> bool {
    let top = name.split('.').next().unwrap_or(name);
    matches!(
        top,
        "os" | "sys"
            | "json"
            | "re"
            | "math"
            | "pathlib"
            | "typing"
            | "collections"
            | "itertools"
            | "functools"
            | "datetime"
            | "time"
            | "subprocess"
            | "threading"
            | "asyncio"
            | "http"
            | "urllib"
            | "io"
            | "abc"
            | "enum"
            | "dataclasses"
            | "logging"
            | "unittest"
            | "pytest"
            | "sqlite3"
            | "hashlib"
            | "base64"
            | "copy"
            | "struct"
            | "tempfile"
            | "shutil"
            | "glob"
            | "argparse"
            | "traceback"
            | "contextlib"
            | "importlib"
            | "builtins"
            | "string"
            | "textwrap"
            | "pprint"
            | "csv"
            | "configparser"
            | "xml"
            | "html"
            | "email"
            | "socket"
            | "ssl"
            | "multiprocessing"
            | "concurrent"
            | "queue"
            | "weakref"
            | "types"
            | "operator"
            | "random"
            | "statistics"
            | "decimal"
            | "fractions"
            | "numbers"
            | "uuid"
            | "platform"
            | "signal"
            | "errno"
            | "ctypes"
            | "mmap"
            | "select"
            | "selectors"
            | "zlib"
            | "gzip"
            | "bz2"
            | "lzma"
            | "zipfile"
            | "tarfile"
            | "pickle"
            | "shelve"
            | "dbm"
            | "zoneinfo"
            | "calendar"
            | "locale"
            | "gettext"
            | "codecs"
            | "unicodedata"
            | "difflib"
            | "shlex"
            | "tkinter"
            | "pdb"
            | "gc"
            | "inspect"
            | "warnings"
            | "contextvars"
            | "graphlib"
            | "tomllib"
            | "ipaddress"
            | "secrets"
            | "hmac"
    )
}

fn resolve_import_target(files: &BTreeSet<String>, target: &str) -> Option<String> {
    let cleaned = target.trim().trim_start_matches("./").replace('\\', "/");
    if files.contains(&cleaned) {
        return Some(cleaned);
    }
    let bare = cleaned
        .rsplit(['/', ':'])
        .next()
        .unwrap_or(cleaned.as_str())
        .trim_end_matches(':');
    let dotted = cleaned.replace('.', "/");
    let candidates = [
        cleaned.clone(),
        format!("{cleaned}.rs"),
        format!("{cleaned}.py"),
        format!("{cleaned}.ts"),
        format!("{cleaned}.tsx"),
        format!("{cleaned}.js"),
        format!("{cleaned}/mod.rs"),
        format!("{cleaned}/__init__.py"),
        format!("{cleaned}/index.ts"),
        format!("{bare}.rs"),
        format!("{bare}.py"),
        format!("{bare}.ts"),
        format!("{bare}.tsx"),
        format!("{bare}/mod.rs"),
        format!("{bare}/__init__.py"),
        format!("{bare}/index.ts"),
        format!("{dotted}.py"),
        format!("{dotted}/__init__.py"),
    ];
    for cand in candidates {
        if files.contains(&cand) {
            return Some(cand);
        }
        if let Some(hit) = files
            .iter()
            .find(|f| f.ends_with(&cand) || f.ends_with(&format!("/{cand}")) || *f == &cand)
        {
            return Some(hit.clone());
        }
    }
    if let Some(rest) = cleaned.strip_prefix("crate::") {
        let first = rest.split("::").next().unwrap_or("");
        if !first.is_empty() {
            return files
                .iter()
                .find(|f| {
                    f.ends_with(&format!("/{first}.rs"))
                        || f.ends_with(&format!("/{first}/mod.rs"))
                        || *f == &format!("{first}.rs")
                })
                .cloned();
        }
    }
    None
}

fn dep_targets_path(dep: &FileDep, path: &str, stem: &str) -> bool {
    if dep.to == path {
        return true;
    }
    if stem.is_empty() {
        return false;
    }
    let to = dep.to.as_str();
    to.ends_with(&format!("/{stem}"))
        || to.ends_with(&format!("/{stem}.rs"))
        || to.ends_with(&format!("/{stem}.ts"))
        || to.ends_with(&format!("/{stem}.tsx"))
        || to.ends_with(&format!("/{stem}.js"))
        || to.ends_with(&format!("/{stem}/mod.rs"))
        || to.ends_with(&format!("/{stem}/index.ts"))
}

fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.contains("/test")
        || lower.contains("\\test")
        || lower.contains(".test.")
        || lower.contains("_test.")
        || lower.ends_with("_test.rs")
        || lower.contains("/tests/")
}

fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string()
}

fn dedupe_deps(deps: &mut Vec<FileDep>) {
    let mut seen = BTreeSet::new();
    deps.retain(|d| seen.insert((d.from.clone(), d.to.clone(), d.kind.clone())));
}

/// Helper puro (§9.4b / Vitest): ¿un specifier JS/TS se trata como externo?
pub fn is_external_js_specifier(spec: &str) -> bool {
    let t = spec.trim();
    if t.is_empty() {
        return true;
    }
    if t.starts_with('@') {
        return true;
    }
    !(t.starts_with('.') || t.starts_with('/') || t.starts_with('#'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bara-live-{tag}-{nonce}"));
        fs::create_dir_all(dir.join("src")).expect("src");
        dir
    }

    #[test]
    fn mapa_lista_deps_archivo_archivo() {
        let root = scratch("deps");
        fs::write(
            root.join("src/lib.rs"),
            "mod util;\npub fn root() { util::helper(); }\n",
        )
        .expect("lib");
        fs::write(root.join("src/util.rs"), "pub fn helper() {}\n").expect("util");
        let root_s = root.to_str().expect("utf8");
        let map = snapshot(root_s).expect("map");
        assert!(map.files.iter().any(|f| f.ends_with("lib.rs")));
        assert!(map.files.iter().any(|f| f.ends_with("util.rs")));
        assert!(
            map.deps
                .iter()
                .any(|d| d.from.contains("lib") && d.to.contains("util"))
                || map
                    .deps
                    .iter()
                    .any(|d| d.kind == "import" || d.kind == "call"),
            "deps={:?}",
            map.deps
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn impacto_y_rotura_de_import_antes_de_escribir() {
        let root = scratch("gate");
        fs::write(root.join("src/a.rs"), "fn a() {}\n").expect("a");
        let root_s = root.to_str().expect("utf8");
        let gate = gate_change(root_s, "src/a.rs", "mod totally_missing;\n").expect("gate");
        assert!(!gate.ok, "debe marcar import roto antes de aplicar");
        assert!(!gate.broken.is_empty());
        let impact = impact(root_s, &["src/a.rs".into()]).expect("impact");
        assert!(impact.files_affected >= 1);
        assert!(impact.summary.contains("archivo"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn falsos_positivos_no_marcan_broken() {
        let root = scratch("fp");
        let host = r#"
use super::*;
use self::*;
use anyhow;
pub use crate::util::*;
#[cfg(test)]
mod tests {
    use super::*;
}
"#;
        fs::write(root.join("src/lib.rs"), host).expect("lib");
        fs::write(root.join("src/util.rs"), "pub fn x() {}\n").expect("util");
        let root_s = root.to_str().expect("utf8");
        // Mismo host → sin imports nuevos.
        let gate = gate_change(root_s, "src/lib.rs", host).expect("gate");
        assert!(gate.ok, "broken={:?}", gate.broken);
        // pub mod hacia archivo existente.
        let with_mod = format!("{host}\npub mod util;\n");
        let gate2 = gate_change(root_s, "src/lib.rs", &with_mod).expect("gate2");
        assert!(
            gate2.ok || gate2.broken.iter().all(|b| b.target != "util"),
            "pub mod util existente no debe romper: {:?}",
            gate2.broken
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn gate_solo_peina_imports_nuevos() {
        let root = scratch("diff");
        let host = "use super::*;\nmod tests {\n    fn t() {}\n}\nfn a() {}\n";
        fs::write(root.join("src/lib.rs"), host).expect("lib");
        let root_s = root.to_str().expect("utf8");
        // Conserva super::* e inline mod; solo añade fn.
        let next = "use super::*;\nmod tests {\n    fn t() {}\n}\nfn a() { /* ok */ }\n";
        let gate = gate_change(root_s, "src/lib.rs", next).expect("gate");
        assert!(
            gate.ok,
            "no debe bloquear por super::* / mod tests {{}}: {:?}",
            gate.broken
        );
        // Nuevo mod de archivo inexistente.
        let bad = format!("{next}mod ghost_module;\n");
        let gate_bad = gate_change(root_s, "src/lib.rs", &bad).expect("bad");
        assert!(!gate_bad.ok);
        assert!(gate_bad.broken.iter().any(|b| b.target == "ghost_module"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lote_fallido_hace_rollback_completo() {
        let root = scratch("batch");
        fs::write(root.join("src/ok.rs"), "fn a() {}\n").expect("ok");
        fs::write(root.join("src/bad.rs"), "fn b() {}\n").expect("bad");
        let root_s = root.to_str().expect("utf8");
        let report = apply_batch(
            root_s,
            &[
                BatchChange {
                    path: "src/ok.rs".into(),
                    source: "fn a() { /* changed */ }\n".into(),
                    expected_hash: None,
                },
                BatchChange {
                    path: "src/nope.env".into(),
                    source: "X=1\n".into(),
                    expected_hash: None,
                },
            ],
        )
        .expect("batch");
        assert!(!report.applied);
        assert!(report.rolled_back, "detail={}", report.detail);
        assert!(!report.backups.is_empty(), "debe haber backup");
        assert!(
            report.backups.iter().any(|b| b.contains(".bara-backup/")),
            "backups={:?}",
            report.backups
        );
        let ok = fs::read_to_string(root.join("src/ok.rs")).expect("read");
        assert_eq!(ok, "fn a() {}\n", "no debe quedar a medias");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lote_rollback_borra_archivo_nuevo() {
        let root = scratch("newfile");
        fs::write(root.join("src/ok.rs"), "fn a() {}\n").expect("ok");
        let root_s = root.to_str().expect("utf8");
        let new_path = root.join("src/brand_new.rs");
        assert!(!new_path.exists());
        let report = apply_batch(
            root_s,
            &[
                BatchChange {
                    path: "src/brand_new.rs".into(),
                    source: "fn fresh() {}\n".into(),
                    expected_hash: None,
                },
                BatchChange {
                    path: "src/nope.env".into(),
                    source: "X=1\n".into(),
                    expected_hash: None,
                },
            ],
        )
        .expect("batch");
        assert!(!report.applied);
        assert!(report.rolled_back, "detail={}", report.detail);
        assert!(
            !new_path.exists(),
            "el archivo nuevo debe borrarse en rollback"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn js_scoped_y_array_from_no_son_imports_proyecto() {
        assert!(is_external_js_specifier("@tauri-apps/api/core"));
        assert!(is_external_js_specifier("react"));
        assert!(!is_external_js_specifier("./local"));
        let src = "const x = Array.from([1]);\nimport { invoke } from '@tauri-apps/api/core';\n";
        let imports = extract_imports("web/x.ts", src);
        assert!(
            imports
                .iter()
                .all(|i| i.target.starts_with('@') || i.target.starts_with('.')),
            "imports={:?}",
            imports
        );
        assert!(imports.iter().any(|i| i.target == "@tauri-apps/api/core"));
        assert!(!imports.iter().any(|i| i.target.contains("Array")));
    }

    #[test]
    fn archivo_vacio_con_dependiente_rompe_con_extension() {
        let root = scratch("empty");
        fs::write(root.join("src/lib.rs"), "mod util;\n").expect("lib");
        fs::write(root.join("src/util.rs"), "pub fn x() {}\n").expect("util");
        let root_s = root.to_str().expect("utf8");
        let _ = snapshot(root_s).expect("map");
        let gate = gate_change(root_s, "src/util.rs", "").expect("gate");
        assert!(
            !gate.ok,
            "vaciar util con dependientes debe romper: {:?}",
            gate.broken
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn python_bare_que_coincide_con_py_es_arista() {
        let root = scratch("pyedge");
        fs::write(root.join("app.py"), "import helper\nimport os\n").expect("app");
        fs::write(root.join("helper.py"), "def x():\n    return 1\n").expect("helper");
        let root_s = root.to_str().expect("utf8");
        let snap = snapshot(root_s).expect("map");
        assert!(
            snap.deps.iter().any(|d| {
                d.kind == "import" && d.from.ends_with("app.py") && d.to.ends_with("helper.py")
            }),
            "deps={:?}",
            snap.deps
        );
        assert!(
            !snap
                .deps
                .iter()
                .any(|d| d.kind == "import" && d.to.ends_with("/os.py") || d.to == "os.py"),
            "stdlib no es arista: {:?}",
            snap.deps
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn python_import_lista_y_bare_arista_sin_resolver_bloquea() {
        let root = scratch("pycomma");
        fs::write(root.join("helper.py"), "def x():\n    return 1\n").expect("helper");
        fs::write(root.join("sidekick.py"), "y = 1\n").expect("side");
        fs::write(root.join("app.py"), "import helper, sidekick, os\n").expect("app");
        let root_s = root.to_str().expect("utf8");
        let snap = snapshot(root_s).expect("map");
        assert!(
            snap.deps.iter().any(|d| d.to.ends_with("helper.py")),
            "helper: {:?}",
            snap.deps
        );
        assert!(
            snap.deps.iter().any(|d| d.to.ends_with("sidekick.py")),
            "sidekick: {:?}",
            snap.deps
        );
        assert!(
            !snap
                .deps
                .iter()
                .any(|d| d.to.ends_with("os.py") || d.to == "os.py"),
            "stdlib: {:?}",
            snap.deps
        );
        fs::write(root.join("app.py"), "x = 1\n").expect("host");
        let blocked = gate_change(root_s, "app.py", "import helper.no_such, os\n").expect("gate");
        assert!(
            !blocked.ok,
            "arista sin resolver debe bloquear: {:?}",
            blocked
        );
        assert!(blocked.broken.iter().any(|b| b.target == "helper.no_such"));
        let external = gate_change(root_s, "app.py", "import requests\n").expect("ext");
        assert!(
            external.ok,
            "paquete externo no es arista: {:?}",
            external.broken
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn use_crate_glob_bloquea_si_no_resuelve_y_super_no() {
        let root = scratch("glob");
        fs::write(root.join("src/lib.rs"), "fn a() {}\n").expect("lib");
        fs::write(root.join("src/util.rs"), "pub fn x() {}\n").expect("util");
        let root_s = root.to_str().expect("utf8");
        let ok = gate_change(root_s, "src/lib.rs", "use crate::util::*;\nfn a() {}\n").expect("ok");
        assert!(ok.ok, "crate::util::* existe: {:?}", ok.broken);
        let bad =
            gate_change(root_s, "src/lib.rs", "use crate::missing::*;\nfn a() {}\n").expect("bad");
        assert!(!bad.ok, "crate::missing::* debe bloquear");
        assert!(bad.broken.iter().any(|b| b.target == "crate::missing"));
        let sup = gate_change(root_s, "src/lib.rs", "use super::*;\nfn a() {}\n").expect("super");
        assert!(sup.ok, "super::* no se bloquea: {:?}", sup.broken);
        let self_glob =
            gate_change(root_s, "src/lib.rs", "use self::*;\nfn a() {}\n").expect("self");
        assert!(
            self_glob.ok,
            "self::* no se bloquea: {:?}",
            self_glob.broken
        );
        let _ = fs::remove_dir_all(root);
    }
}
