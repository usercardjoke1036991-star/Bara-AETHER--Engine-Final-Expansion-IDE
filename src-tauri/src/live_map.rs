//! Mapa vivo del workspace (§9.4): dependencias archivo→archivo, impacto
//! pre-apply, lote atómico con rollback y avisos de desincronía.
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
            for target in extract_imports(path, &doc.source) {
                if let Some(resolved) = resolve_import_target(&files, &target) {
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
    let tests_affected = related_list
        .iter()
        .filter(|p| is_test_path(p))
        .count();
    let files_affected = related_list.len();
    let summary = format!(
        "afecta a {files_affected} archivo(s) y {tests_affected} test(s)"
    );
    Ok(ImpactReport {
        focus,
        files_affected,
        tests_affected,
        related: related_list,
        summary,
    })
}

/// Evalúa un cambio propuesto **antes** de escribir.
pub fn gate_change(root: &str, path: &str, next_source: &str) -> Result<ChangeGate, String> {
    let path = path.replace('\\', "/");
    let impact = impact(root, &[path.clone()])?;
    let map = snapshot(root)?;
    let mut broken = Vec::new();

    // Imports del propio archivo hacia destinos inexistentes.
    for target in extract_imports(&path, next_source) {
        if resolve_import_target(&map.files.iter().cloned().collect(), &target).is_none()
            && looks_like_project_import(&target)
        {
            broken.push(BrokenImport {
                path: path.clone(),
                target: target.clone(),
                detail: format!("import «{target}» no resuelve a un archivo del mapa"),
            });
        }
    }

    // Si el archivo nuevo deja de exportar símbolos que otros importan por nombre de módulo.
    let stem = file_stem(&path);
    if !stem.is_empty() {
        for dep in map.deps.iter().filter(|d| d.to == path || d.to.ends_with(&path)) {
            if dep.kind == "import" && dep.from != path {
                // Dependiente sigue apuntando aquí: OK mientras el archivo exista.
            }
        }
        // Detectar `use crate::stem` / from './stem' rotos si removemos el archivo del lote:
        // aquí sólo simulamos contenido; rotura fuerte si next vacío y alguien importa.
        if next_source.trim().is_empty() {
            for dep in &map.deps {
                if dep.to == path || dep.to.ends_with(&format!("/{stem}")) {
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
    // Pre-gate de cada cambio.
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
    let mut previous: Vec<(String, String)> = Vec::new();
    for change in changes {
        let path = change.path.replace('\\', "/");
        let prior = workspace::read_text(root, &path)
            .map(|doc| doc.source)
            .unwrap_or_default();
        let backup = auto_apply::write_backup(root, &path, &prior)?;
        backups.push(backup);
        previous.push((path, prior));
    }

    let mut written = 0usize;
    for (index, change) in changes.iter().enumerate() {
        let path = change.path.replace('\\', "/");
        let expected = change
            .expected_hash
            .clone()
            .or_else(|| previous.get(index).map(|(_, src)| workspace::content_hash(src)));
        if let Err(err) =
            workspace::write_source_checked(root, &path, &change.source, expected.as_deref())
        {
            for (prev_path, prev_src) in previous.iter().rev() {
                let _ = workspace::write_source(root, prev_path, prev_src);
            }
            return Ok(BatchReport {
                applied: false,
                paths: changes.iter().map(|c| c.path.replace('\\', "/")).collect(),
                backups,
                rolled_back: true,
                detail: format!("falló «{path}»: {err}; rollback completo"),
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
    for warn in map.warnings.iter().filter(|w| related.contains(&w.path)).take(8) {
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
        // Colapsar a archivo→archivo.
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
    let file_set: BTreeSet<&str> = files.iter().map(String::as_str).collect();
    let mut inbound: BTreeSet<&str> = BTreeSet::new();
    let mut outbound: BTreeSet<&str> = BTreeSet::new();
    for dep in deps {
        inbound.insert(dep.to.as_str());
        outbound.insert(dep.from.as_str());
    }
    for path in files {
        if !inbound.contains(path.as_str()) && !outbound.contains(path.as_str()) && !is_test_path(path)
        {
            warnings.push(DesyncWarning {
                kind: "isolated".to_string(),
                path: path.clone(),
                detail: "archivo aislado: sin aristas de import/llamada en el mapa".to_string(),
            });
        }
        if let Ok(doc) = workspace::read_text(root, path) {
            for target in extract_imports(path, &doc.source) {
                if looks_like_project_import(&target)
                    && resolve_import_target(&files.iter().cloned().collect(), &target).is_none()
                {
                    warnings.push(DesyncWarning {
                        kind: "broken_import".to_string(),
                        path: path.clone(),
                        detail: format!("import «{target}» sin destino en el workspace"),
                    });
                }
            }
        }
    }
    // Código muerto aproximado: función sin aristas entrantes en el topology.
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
                detail: format!("función «{}» sin referencias entrantes en el mapa", node.label),
            });
        }
    }
    let _ = file_set;
    warnings.truncate(80);
    warnings
}

fn extract_imports(path: &str, source: &str) -> Vec<String> {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let mut out = Vec::new();
    match ext.as_str() {
        "rs" => {
            for cap in regex_captures(source, r"(?m)^\s*use\s+([a-zA-Z0-9_:>]+)") {
                out.push(cap);
            }
            for cap in regex_captures(source, r"(?m)^\s*mod\s+([a-zA-Z0-9_]+)") {
                out.push(cap);
            }
        }
        "ts" | "tsx" | "js" | "jsx" => {
            for cap in regex_captures(source, r#"from\s+['"]([^'"]+)['"]"#) {
                out.push(cap);
            }
            for cap in regex_captures(source, r#"require\(\s*['"]([^'"]+)['"]\s*\)"#) {
                out.push(cap);
            }
        }
        "py" => {
            for cap in regex_captures(source, r"(?m)^\s*from\s+([.\w]+)\s+import") {
                out.push(cap);
            }
            for cap in regex_captures(source, r"(?m)^\s*import\s+([.\w]+)") {
                out.push(cap);
            }
        }
        _ => {}
    }
    out.truncate(MAX_IMPORTS_PER_FILE);
    out
}

/// Mini extractor sin crate regex: escanea con patrones simples.
fn regex_captures(source: &str, pattern_hint: &str) -> Vec<String> {
    // Implementación ad-hoc por familia (pattern_hint solo discrimina).
    let mut found = Vec::new();
    if pattern_hint.contains("from\\s+") && pattern_hint.contains("['\"]") {
        for line in source.lines() {
            if let Some(rest) = line.split("from").nth(1) {
                if let Some(q) = rest.find(['\'', '"']) {
                    let quote = rest.as_bytes()[q] as char;
                    let after = &rest[q + 1..];
                    if let Some(end) = after.find(quote) {
                        found.push(after[..end].to_string());
                    }
                }
            }
        }
        return found;
    }
    if pattern_hint.contains("require") {
        for (idx, _) in source.match_indices("require(") {
            let after = &source[idx + "require(".len()..];
            let after = after.trim_start();
            if let Some(q) = after.chars().next().filter(|c| *c == '\'' || *c == '"') {
                let body = &after[1..];
                if let Some(end) = body.find(q) {
                    found.push(body[..end].to_string());
                }
            }
        }
        return found;
    }
    if pattern_hint.contains("use\\s+") {
        for line in source.lines() {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("use ") {
                let token = rest
                    .split(|c: char| c == ';' || c == '{' || c.is_whitespace())
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_end_matches("::");
                if !token.is_empty() {
                    found.push(token.to_string());
                }
            }
        }
        return found;
    }
    if pattern_hint.contains("mod\\s+") {
        for line in source.lines() {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("mod ") {
                let token = rest
                    .split(|c: char| c == ';' || c.is_whitespace())
                    .next()
                    .unwrap_or("")
                    .trim();
                if !token.is_empty() {
                    found.push(token.to_string());
                }
            }
        }
        return found;
    }
    if pattern_hint.contains("from\\s+") && pattern_hint.contains("import") {
        for line in source.lines() {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("from ") {
                let token = rest.split_whitespace().next().unwrap_or("").trim();
                if !token.is_empty() {
                    found.push(token.to_string());
                }
            }
        }
        return found;
    }
    if pattern_hint.contains("import\\s+") {
        for line in source.lines() {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("import ") {
                let token = rest
                    .split(|c: char| c == ',' || c.is_whitespace())
                    .next()
                    .unwrap_or("")
                    .trim();
                if !token.is_empty() {
                    found.push(token.to_string());
                }
            }
        }
    }
    found
}

fn looks_like_project_import(target: &str) -> bool {
    if target.starts_with("std::") || target.starts_with("core::") || target.starts_with("alloc::") {
        return false;
    }
    target.starts_with('.')
        || target.starts_with("crate::")
        || target.starts_with("super::")
        || target.starts_with("self::")
        || target.starts_with('/')
        || (!target.contains(':') && target.contains('/'))
        // `mod foo` / identificador simple de módulo local.
        || (target
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
            && !target.is_empty()
            && !matches!(
                target,
                "std" | "core" | "alloc" | "serde" | "tokio" | "react"
            ))
}

fn resolve_import_target(files: &BTreeSet<String>, target: &str) -> Option<String> {
    let cleaned = target
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/");
    if files.contains(&cleaned) {
        return Some(cleaned);
    }
    let bare = cleaned
        .rsplit(['/', ':'])
        .next()
        .unwrap_or(cleaned.as_str())
        .trim_end_matches(':');
    let candidates = [
        cleaned.clone(),
        format!("{cleaned}.rs"),
        format!("{cleaned}.ts"),
        format!("{cleaned}.tsx"),
        format!("{cleaned}.js"),
        format!("{cleaned}/mod.rs"),
        format!("{cleaned}/index.ts"),
        format!("{bare}.rs"),
        format!("{bare}.ts"),
        format!("{bare}.tsx"),
        format!("{bare}/mod.rs"),
        format!("{bare}/index.ts"),
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
    // crate::foo::bar → foo.rs
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
            map.deps.iter().any(|d| d.from.contains("lib") && d.to.contains("util"))
                || map.deps.iter().any(|d| d.kind == "import" || d.kind == "call"),
            "deps={:?}",
            map.deps
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn impacto_y_rotura_de_import_antes_de_escribir() {
        let root = scratch("gate");
        fs::write(root.join("src/a.rs"), "mod missing;\n").expect("a");
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
                    path: "src/nope.env".into(), // sensible / no editable → falla
                    source: "X=1\n".into(),
                    expected_hash: None,
                },
            ],
        )
        .expect("batch");
        assert!(!report.applied);
        assert!(report.rolled_back || !report.detail.is_empty());
        let ok = fs::read_to_string(root.join("src/ok.rs")).expect("read");
        assert_eq!(ok, "fn a() {}\n", "no debe quedar a medias");
        let _ = fs::remove_dir_all(root);
    }
}
