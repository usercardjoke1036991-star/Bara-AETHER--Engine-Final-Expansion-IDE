//! Grafo topológico de la carpeta activa.
//!
//! Los nodos salen del parser nativo y del catálogo de extensiones del
//! proyecto. Las aristas pesan con [`bara::neural_bridge::topological_distance`].
//! No abre sockets ni acepta una raíz elegida por el WebView.

#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use bara::autopoietic::BelnapValue;
use bara::ffi_ingest::{BaraType, ShoreshNode};
use bara::neural_bridge::topological_distance;
use bara::runtime::QuantumState;
use bara::syntax::{self, SourceSymbol};
use bara::topology::{AstChart, METRIC_CAP};
use bara::transmuter::{Concept, SourceLanguage};
use serde::Serialize;

use crate::workspace;

const MAX_FILES: usize = 48;
const MAX_READ: usize = 32 * 1024;
const MAX_NODES: usize = 360;
const MAX_EDGES: usize = 720;
const MAX_DEPTH: usize = 12;

/// Nodo del grafo de la carpeta activa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Identidad estable dentro de esta respuesta.
    pub id: String,
    /// Nombre visible.
    pub label: String,
    /// `file`, `function`, `type` o `contract`.
    pub kind: String,
    /// Raíz *Shoresh* del concepto.
    pub shoresh_root: String,
    /// Glifo de Belnap: `⊤`, `⊥`, `⊤∧⊥` o `∅`.
    pub conflict_status: String,
    /// Extensión del archivo, en minúsculas.
    pub language: String,
    /// Ruta relativa a la carpeta activa.
    pub path: String,
    /// Línea 1-based. Los archivos usan 1.
    pub line: u32,
}

/// Arista dirigida. `weight` es la distancia topológica del par.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    /// Distancia en `0..=METRIC_CAP`.
    pub weight: u32,
}

/// Grafo completo de la carpeta activa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTopology {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// `true` si la cota de archivos, nodos o aristas recortó el grafo.
    pub truncated: bool,
}

struct Decl {
    id: String,
    label: String,
    path: String,
    parent: String,
}

struct CallSite {
    path: String,
    parent: String,
    name: String,
}

/// Construye el grafo de `root`, que tiene que ser la carpeta activa ya resuelta.
pub fn build(root: &str) -> Result<WorkspaceTopology, String> {
    let canonical = fs::canonicalize(root)
        .map_err(|err| format!("no se pudo leer la carpeta activa: {err}"))?;
    if !canonical.is_dir() {
        return Err("la carpeta activa no es un directorio".to_string());
    }
    let mut files = Vec::new();
    collect_sources(&canonical, &canonical, "", 0, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut truncated = files.len() > MAX_FILES;
    files.truncate(MAX_FILES);

    let mut nodes = Vec::new();
    let mut decls: Vec<Decl> = Vec::new();
    let mut calls: Vec<CallSite> = Vec::new();
    for (relative, path) in files {
        if nodes.len() >= MAX_NODES {
            truncated = true;
            break;
        }
        let Some(text) = read_capped(&path) else {
            continue;
        };
        let language = language_of(&relative);
        absorb(
            &relative,
            &text,
            language,
            &mut nodes,
            &mut decls,
            &mut calls,
            &mut truncated,
        );
    }
    mark_duplicates(&mut nodes);
    let mut edges = link(&nodes, &decls, &calls);
    if edges.len() > MAX_EDGES {
        truncated = true;
        edges.truncate(MAX_EDGES);
    }
    nodes.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then(left.line.cmp(&right.line))
            .then(left.kind.cmp(&right.kind))
            .then(left.label.cmp(&right.label))
            .then(left.id.cmp(&right.id))
    });
    edges.sort_by(|left, right| {
        left.source
            .cmp(&right.source)
            .then(left.target.cmp(&right.target))
    });
    Ok(WorkspaceTopology {
        nodes,
        edges,
        truncated,
    })
}

fn absorb(
    relative: &str,
    text: &str,
    language: Option<SourceLanguage>,
    nodes: &mut Vec<GraphNode>,
    decls: &mut Vec<Decl>,
    calls: &mut Vec<CallSite>,
    truncated: &mut bool,
) {
    let ext = extension_of(relative);
    let file_id = format!("file:{relative}");
    let balanced = language
        .map(|lang| syntax::parse(lang, text).balanced)
        .unwrap_or(true);
    nodes.push(GraphNode {
        id: file_id.clone(),
        label: file_label(relative),
        kind: "file".to_string(),
        shoresh_root: Concept::Open.root().to_string(),
        conflict_status: if balanced {
            BelnapValue::True.glyph().to_string()
        } else {
            BelnapValue::Both.glyph().to_string()
        },
        language: ext,
        path: relative.to_string(),
        line: 1,
    });
    let Some(language) = language else {
        return;
    };
    let tree = syntax::parse(language, text);
    for symbol in tree.symbols() {
        if nodes.len() >= MAX_NODES {
            *truncated = true;
            return;
        }
        if symbol.kind == "call" {
            let name = symbol
                .name
                .split(['.', ':'])
                .next()
                .unwrap_or(symbol.name.as_str());
            if !name.is_empty() && name != "_" {
                calls.push(CallSite {
                    path: relative.to_string(),
                    parent: symbol.parent.clone(),
                    name: name.to_string(),
                });
            }
            continue;
        }
        let kind = node_kind(language, text, &symbol);
        let concept = Concept::Define;
        let id = format!("sym:{relative}:{}:{}:{}", kind, symbol.line, symbol.name);
        nodes.push(GraphNode {
            id: id.clone(),
            label: symbol.name.clone(),
            kind: kind.to_string(),
            shoresh_root: concept.root().to_string(),
            conflict_status: status_of(concept).to_string(),
            language: extension_of(relative),
            path: relative.to_string(),
            line: symbol.line.max(1),
        });
        decls.push(Decl {
            id,
            label: symbol.name,
            path: relative.to_string(),
            parent: symbol.parent,
        });
    }
}

fn node_kind(language: SourceLanguage, source: &str, symbol: &SourceSymbol) -> &'static str {
    if symbol.kind == "type" && language == SourceLanguage::Solidity {
        let line = source
            .lines()
            .nth(usize::try_from(symbol.line.saturating_sub(1)).unwrap_or(0))
            .unwrap_or("");
        let head = line.split(&symbol.name).next().unwrap_or("");
        if head.contains("contract") || head.contains("interface") || head.contains("library") {
            return "contract";
        }
    }
    match symbol.kind {
        "fn" => "function",
        "type" => "type",
        _ => "type",
    }
}

fn status_of(concept: Concept) -> &'static str {
    let falsity = concept.falsity();
    let truth = (1.0 - falsity).clamp(0.0, 1.0);
    BelnapValue::from_masses(truth, falsity).glyph()
}

fn mark_duplicates(nodes: &mut [GraphNode]) {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for node in nodes.iter() {
        if matches!(node.kind.as_str(), "function" | "type" | "contract") {
            *counts.entry(node.label.clone()).or_insert(0) += 1;
        }
    }
    let both = BelnapValue::Both.glyph();
    for node in nodes.iter_mut() {
        if matches!(node.kind.as_str(), "function" | "type" | "contract")
            && counts.get(&node.label).copied().unwrap_or(0) > 1
        {
            node.conflict_status = both.to_string();
        }
    }
}

fn link(nodes: &[GraphNode], decls: &[Decl], calls: &[CallSite]) -> Vec<GraphEdge> {
    let mut edges = Vec::new();
    let mut seen = BTreeSet::new();
    for decl in decls {
        let file_id = format!("file:{}", decl.path);
        let file_name = file_label(&decl.path);
        let parent = find_decl(decls, &decl.parent, &decl.path)
            .filter(|parent| parent.id != decl.id)
            .map(|parent| parent.id.clone());
        let source = parent.unwrap_or(file_id);
        let left = if source.starts_with("file:") {
            file_name
        } else {
            decl.parent.clone()
        };
        push_edge(&mut edges, &mut seen, &source, &decl.id, &left, &decl.label);
    }
    for call in calls {
        let Some(target) = find_decl(decls, &call.name, &call.path) else {
            continue;
        };
        let source = find_decl(decls, &call.parent, &call.path)
            .filter(|decl| decl.id != target.id)
            .map(|decl| decl.id.clone())
            .unwrap_or_else(|| format!("file:{}", call.path));
        let left = if source.starts_with("file:") {
            file_label(&call.path)
        } else {
            call.parent.clone()
        };
        push_edge(
            &mut edges, &mut seen, &source, &target.id, &left, &call.name,
        );
    }
    tension_edges(nodes, &mut edges, &mut seen);
    edges
}

fn find_decl<'a>(decls: &'a [Decl], label: &str, path: &str) -> Option<&'a Decl> {
    if label.is_empty() {
        return None;
    }
    decls
        .iter()
        .find(|decl| decl.label == label && decl.path == path)
        .or_else(|| decls.iter().find(|decl| decl.label == label))
}

fn tension_edges(
    nodes: &[GraphNode],
    edges: &mut Vec<GraphEdge>,
    seen: &mut BTreeSet<(String, String)>,
) {
    let mut groups: BTreeMap<&str, Vec<&GraphNode>> = BTreeMap::new();
    for node in nodes {
        if matches!(node.kind.as_str(), "function" | "type" | "contract") {
            groups.entry(node.label.as_str()).or_default().push(node);
        }
    }
    for group in groups.values() {
        let Some(first) = group.first() else {
            continue;
        };
        for other in group.iter().skip(1) {
            push_edge(edges, seen, &first.id, &other.id, &first.path, &other.path);
        }
    }
}

fn push_edge(
    edges: &mut Vec<GraphEdge>,
    seen: &mut BTreeSet<(String, String)>,
    source: &str,
    target: &str,
    left: &str,
    right: &str,
) {
    if edges.len() >= MAX_EDGES || source.is_empty() || target.is_empty() || source == target {
        return;
    }
    if !seen.insert((source.to_string(), target.to_string())) {
        return;
    }
    edges.push(GraphEdge {
        source: source.to_string(),
        target: target.to_string(),
        weight: metric_weight(left, right),
    });
}

fn metric_weight(left: &str, right: &str) -> u32 {
    let left_chart = AstChart::from_nodes(&[metric_node(left)]);
    let right_chart = AstChart::from_nodes(&[metric_node(right)]);
    match (left_chart.points().first(), right_chart.points().first()) {
        (Some(left_point), Some(right_point)) => topological_distance(left_point, right_point),
        _ => METRIC_CAP,
    }
}

fn metric_node(root: &str) -> ShoreshNode {
    ShoreshNode {
        root: root.chars().take(64).collect(),
        original: root.chars().take(64).collect(),
        arity: 0,
        ret: BaraType::Unknown,
        hazard: 0.0,
        valence: QuantumState::paraconsistent(1.0, 0.0),
        sanitized: false,
    }
}

fn file_label(relative: &str) -> String {
    relative.rsplit('/').next().unwrap_or(relative).to_string()
}

fn extension_of(relative: &str) -> String {
    relative
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn language_of(relative: &str) -> Option<SourceLanguage> {
    if !workspace::is_project_source(Path::new(relative)) {
        return None;
    }
    match extension_of(relative).as_str() {
        "rs" => Some(SourceLanguage::Rust),
        "py" => Some(SourceLanguage::Python),
        "go" => Some(SourceLanguage::Go),
        "sol" => Some(SourceLanguage::Solidity),
        "c" | "h" | "cpp" | "cc" | "hpp" => Some(SourceLanguage::C),
        "js" | "jsx" | "ts" | "tsx" => Some(SourceLanguage::JavaScript),
        _ => None,
    }
}

fn collect_sources(
    root: &Path,
    dir: &Path,
    relative: &str,
    depth: usize,
    out: &mut Vec<(String, PathBuf)>,
) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES.saturating_mul(4) {
        return;
    }
    let Ok(reader) = fs::read_dir(dir) else {
        return;
    };
    let mut pending = Vec::new();
    for item in reader {
        let Ok(item) = item else {
            continue;
        };
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "target" | "node_modules" | ".git"
        ) {
            continue;
        }
        pending.push((name, item.path(), file_type.is_dir()));
    }
    pending.sort_by(|left, right| left.0.cmp(&right.0));
    for (name, path, is_dir) in pending {
        if out.len() >= MAX_FILES.saturating_mul(4) {
            break;
        }
        let child = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if is_dir {
            let Ok(canonical_child) = fs::canonicalize(&path) else {
                continue;
            };
            if !canonical_child.starts_with(root) {
                continue;
            }
            collect_sources(root, &canonical_child, &child, depth.saturating_add(1), out);
        } else if workspace::is_project_source(&path) {
            let Ok(canonical_file) = fs::canonicalize(&path) else {
                continue;
            };
            if canonical_file.starts_with(root) {
                out.push((child, canonical_file));
            }
        }
    }
}

fn read_capped(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut buffer = vec![0u8; MAX_READ];
    let read = file.read(&mut buffer).ok()?;
    let bytes = buffer.get(..read)?;
    let mut end = bytes.len();
    while end > 0 && std::str::from_utf8(bytes.get(..end)?).is_err() {
        end = end.saturating_sub(1);
        if bytes.len().saturating_sub(end) > 3 {
            return None;
        }
    }
    std::str::from_utf8(bytes.get(..end)?)
        .ok()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bara-grafo-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("directorio");
        dir
    }

    #[test]
    fn el_grafo_une_archivo_funcion_y_contrato_sin_salir_de_la_carpeta() {
        let root = fixture("dentro");
        let outside = fixture("fuera");
        fs::write(
            root.join("lib.rs"),
            "fn alpha() {}\nfn beta() { alpha(); }\n",
        )
        .expect("rs");
        fs::write(
            root.join("token.sol"),
            "contract Token {\n    function transfer() { send(); }\n}\n",
        )
        .expect("sol");
        fs::write(outside.join("lib.rs"), "fn zeta_secret() {}\n").expect("ajena");
        let canonical = fs::canonicalize(&root)
            .expect("canon")
            .display()
            .to_string();
        let graph = build(&canonical).expect("grafo");
        let again = build(&canonical).expect("otro");
        assert_eq!(graph, again);
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.label == "alpha" && node.line == 1));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.label == "beta" && node.kind == "function"));
        assert!(graph
            .nodes
            .iter()
            .any(|node| node.kind == "contract" && node.label == "Token"));
        assert!(graph.nodes.iter().all(|node| !node.label.contains("zeta")));
        assert!(graph.edges.iter().all(|edge| edge.weight <= METRIC_CAP));
        assert!(graph.edges.iter().any(|edge| {
            let source = graph.nodes.iter().find(|node| node.id == edge.source);
            let target = graph.nodes.iter().find(|node| node.id == edge.target);
            source.is_some_and(|node| node.label == "beta")
                && target.is_some_and(|node| node.label == "alpha")
        }));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn un_nombre_repetido_queda_en_contradiccion() {
        let root = fixture("ambos");
        fs::write(root.join("a.rs"), "fn alpha() {}\n").expect("a");
        fs::write(root.join("b.rs"), "fn alpha() {}\n").expect("b");
        let canonical = fs::canonicalize(&root)
            .expect("canon")
            .display()
            .to_string();
        let graph = build(&canonical).expect("grafo");
        let alphas: Vec<_> = graph
            .nodes
            .iter()
            .filter(|node| node.label == "alpha")
            .collect();
        assert_eq!(alphas.len(), 2);
        assert!(alphas.iter().all(|node| node.conflict_status == "⊤∧⊥"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn la_lectura_de_una_fuente_no_acepta_escapes() {
        let root = fixture("lectura");
        fs::write(root.join("lib.rs"), "fn alpha() {}\n").expect("rs");
        let canonical = fs::canonicalize(&root)
            .expect("canon")
            .display()
            .to_string();
        assert!(workspace::read_text(&canonical, "lib.rs").is_ok());
        assert!(workspace::read_text(&canonical, "../fuera.rs").is_err());
        assert!(workspace::read_text(&canonical, r"C:\Windows\system.ini").is_err());
        fs::write(root.join("secret.env"), "TOKEN=1\n").expect("env");
        assert!(workspace::read_text(&canonical, "secret.env").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn el_modulo_no_abre_la_red() {
        let src = include_str!("graph.rs");
        let production = src.split("mod tests").next().unwrap_or(src);
        let lower = production.to_ascii_lowercase();
        assert!(!lower.contains("tcpstream"));
        assert!(!lower.contains("reqwest"));
        assert!(!production.contains("https://"));
        assert!(!production.contains("Command::new"));
    }
}
