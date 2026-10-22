//! Autocompletado local y determinista.
//!
//! El comando lee la carpeta activa, el catálogo *Shoresh* y la malla
//! cognitiva ya indexada. Ordena con [`bara::neural_bridge::topological_distance`]
//! (saltos en la carta, edición de la raíz y aridad) y con la cohesión de
//! [`bara::neural_bridge::survey_roots`]. No abre sockets ni procesos.

#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use bara::ast_dna::embed_root;
use bara::ffi_ingest::{BaraType, ShoreshNode};
use bara::neural_bridge::{conceptual_milli, survey_roots, topological_distance};
use bara::runtime::QuantumState;
use bara::syntax::{self, SourceSymbol};
use bara::topology::{AstChart, CHART_CAP, METRIC_CAP};
use bara::transmuter::{Concept, SourceLanguage};
use serde::Serialize;

use crate::telemetry::{CognitiveShelf, IndexedLabel};
use crate::workspace::ActiveWorkspace;

const MAX_FILES: usize = 24;
const MAX_READ: usize = 32 * 1024;
const MAX_HITS: usize = 128;
const MAX_DEPTH: usize = 12;
const MAX_SUGGESTIONS: usize = 8;
const MAX_PREFIX: usize = 64;
const RECHECK_EVERY: u64 = 32;
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

/// Sugerencia lista para el texto fantasma del editor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCompletion {
    /// Inserción completa, incluido el prefijo ya escrito.
    pub text: String,
    /// Inserción hasta el siguiente segmento (`_`, espacio o fin).
    pub partial: String,
    /// Origen: raíz, función, tipo, llamada, malla o patrón.
    pub detail: String,
    /// Distancia topológica respecto del prefijo, en `0..=METRIC_CAP` más saltos.
    pub distance: u32,
    /// Cohesión, en milésimas, con la raíz dominante de la malla de la carpeta.
    pub cohesion_milli: u16,
}

/// Índice de nombres de la carpeta activa. Se reutiliza entre pulsaciones.
#[derive(Debug, Default)]
pub struct CompletionCache {
    root: String,
    stamp: u64,
    hits: Vec<Hit>,
    queries: u64,
    ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Hit {
    text: String,
    detail: String,
    shoresh: String,
    arity: u16,
    depth: u16,
    file: String,
    kind: &'static str,
}

struct Harvest {
    stamp: u64,
    hits: Vec<Hit>,
}

struct Pattern {
    text: &'static str,
    kind: &'static str,
    detail: &'static str,
}

const RUST_PATTERNS: &[Pattern] = &[
    Pattern {
        text: "fn ",
        kind: "fn",
        detail: "patrón · función",
    },
    Pattern {
        text: "struct ",
        kind: "type",
        detail: "patrón · tipo",
    },
];

const PYTHON_PATTERNS: &[Pattern] = &[
    Pattern {
        text: "def ",
        kind: "fn",
        detail: "patrón · función",
    },
    Pattern {
        text: "class ",
        kind: "type",
        detail: "patrón · tipo",
    },
];

const GO_PATTERNS: &[Pattern] = &[
    Pattern {
        text: "func ",
        kind: "fn",
        detail: "patrón · función",
    },
    Pattern {
        text: "type ",
        kind: "type",
        detail: "patrón · tipo",
    },
];

const SCRIPT_PATTERNS: &[Pattern] = &[
    Pattern {
        text: "function ",
        kind: "fn",
        detail: "patrón · función",
    },
    Pattern {
        text: "class ",
        kind: "type",
        detail: "patrón · tipo",
    },
];

const SOLIDITY_PATTERNS: &[Pattern] = &[
    Pattern {
        text: "function ",
        kind: "fn",
        detail: "patrón · función",
    },
    Pattern {
        text: "contract ",
        kind: "type",
        detail: "patrón · tipo",
    },
];

struct Scored {
    text: String,
    partial: String,
    detail: String,
    distance: u32,
    cohesion: u16,
    lane: u16,
    frequency: u16,
    same_file: bool,
}

impl CompletionCache {
    /// Caché vacía. La primera consulta de una carpeta construye el índice.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Respuesta del comando: jaula activa, malla y catálogo. Sin red.
pub fn answer(
    line: u32,
    prefix: &str,
    path: &str,
    state: &ActiveWorkspace,
    cognition: &Mutex<CognitiveShelf>,
    cache: &Mutex<CompletionCache>,
) -> Result<Vec<LocalCompletion>, String> {
    let root = state.get()?;
    let labels = {
        let shelf = cognition.lock().map_err(|_| {
            "autocompletado no disponible (cerrojo de la malla envenenado)".to_string()
        })?;
        shelf.indexed_labels(&root)
    };
    let mut cache = cache
        .lock()
        .map_err(|_| "autocompletado no disponible (cerrojo del índice envenenado)".to_string())?;
    complete(line, prefix, path, &root, &labels, &mut cache)
}

/// Calcula las sugerencias. `path` sólo desempata y elige el patrón; no se abre.
pub fn complete(
    line: u32,
    prefix: &str,
    path: &str,
    root: &str,
    cognitive: &[IndexedLabel],
    cache: &mut CompletionCache,
) -> Result<Vec<LocalCompletion>, String> {
    guard_path(path)?;
    let prefix = normalize_prefix(prefix)?;
    if prefix.is_empty() {
        return Ok(Vec::new());
    }
    let line = line.clamp(1, 100_000);
    if root.is_empty() {
        return Ok(rank(line, prefix, path, &[], cognitive));
    }
    ensure(cache, root)?;
    Ok(rank(line, prefix, path, &cache.hits, cognitive))
}

fn ensure(cache: &mut CompletionCache, root: &str) -> Result<(), String> {
    cache.queries = cache.queries.saturating_add(1);
    let due = cache.queries.is_multiple_of(RECHECK_EVERY);
    if cache.ready && cache.root == root && !due {
        return Ok(());
    }
    let next = harvest(root)?;
    if cache.ready && cache.root == root && cache.stamp == next.stamp {
        return Ok(());
    }
    cache.root = root.to_string();
    cache.stamp = next.stamp;
    cache.hits = next.hits;
    cache.ready = true;
    Ok(())
}

fn rank(
    line: u32,
    prefix: &str,
    path: &str,
    hits: &[Hit],
    cognitive: &[IndexedLabel],
) -> Vec<LocalCompletion> {
    let mut pool: Vec<Hit> = hits.to_vec();
    for entry in bara_ide::catalogue() {
        pool.push(Hit {
            text: entry.glyph.to_string(),
            detail: format!("raíz · {}", entry.meaning),
            shoresh: entry.glyph.to_string(),
            arity: 0,
            depth: 0,
            file: String::new(),
            kind: "raíz",
        });
    }
    for label in cognitive {
        pool.push(Hit {
            text: label.text.clone(),
            detail: format!("malla · {}", label.root),
            shoresh: label.root.clone(),
            arity: label.arity,
            depth: label.depth,
            file: String::new(),
            kind: "malla",
        });
    }
    push_patterns(path, &mut pool);

    let mut frequency: BTreeMap<String, u16> = BTreeMap::new();
    for hit in &pool {
        let count = frequency.entry(hit.text.clone()).or_insert(0);
        *count = count.saturating_add(1);
    }

    let focus = dominant_root(cognitive);
    let mut scored = Vec::new();
    for hit in &pool {
        if !hit.text.starts_with(prefix) || hit.text == prefix {
            continue;
        }
        let shoresh = if hit.shoresh.is_empty() {
            hit.text.as_str()
        } else {
            hit.shoresh.as_str()
        };
        let times = frequency.get(&hit.text).copied().unwrap_or(1);
        scored.push(Scored {
            partial: partial_text(prefix, &hit.text),
            distance: geometric_distance(line, prefix, &hit.text, hit.arity, hit.depth),
            cohesion: cohesion_of(focus, shoresh),
            lane: lane_distance(prefix, &hit.text),
            frequency: times,
            same_file: !path.is_empty() && hit.file == normalize_slashes(path),
            text: hit.text.clone(),
            detail: hit.detail.clone(),
        });
    }

    scored.sort_by(|left, right| {
        left.distance
            .cmp(&right.distance)
            .then(left.lane.cmp(&right.lane))
            .then(right.cohesion.cmp(&left.cohesion))
            .then(right.frequency.cmp(&left.frequency))
            .then(right.same_file.cmp(&left.same_file))
            .then(left.text.cmp(&right.text))
            .then(left.detail.cmp(&right.detail))
    });

    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for item in scored {
        if !seen.insert(item.text.clone()) {
            continue;
        }
        out.push(LocalCompletion {
            text: item.text,
            partial: item.partial,
            detail: item.detail,
            distance: item.distance,
            cohesion_milli: item.cohesion,
        });
        if out.len() == MAX_SUGGESTIONS {
            break;
        }
    }
    out
}

fn push_patterns(path: &str, pool: &mut Vec<Hit>) {
    let kinds: Vec<&'static str> = pool.iter().map(|hit| hit.kind).collect();
    for pattern in patterns_for(path) {
        let count = kinds.iter().filter(|kind| **kind == pattern.kind).count();
        if count < 2 {
            continue;
        }
        pool.push(Hit {
            text: pattern.text.to_string(),
            detail: pattern.detail.to_string(),
            shoresh: Concept::Define.root().to_string(),
            arity: 0,
            depth: 0,
            file: normalize_slashes(path),
            kind: "patrón",
        });
    }
}

fn patterns_for(path: &str) -> &'static [Pattern] {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let ext = name.rsplit('.').next().unwrap_or("");
    if name == ext {
        return &[];
    }
    match ext {
        "rs" => RUST_PATTERNS,
        "py" => PYTHON_PATTERNS,
        "go" => GO_PATTERNS,
        "js" | "jsx" | "ts" | "tsx" => SCRIPT_PATTERNS,
        "sol" => SOLIDITY_PATTERNS,
        _ => &[],
    }
}

fn geometric_distance(line: u32, prefix: &str, name: &str, arity: u16, depth: u16) -> u32 {
    let chart = u16::try_from(CHART_CAP).unwrap_or(32);
    let focus_index = u16::try_from(line % u32::from(chart)).unwrap_or(0);
    let slot = depth % chart;
    let left = AstChart::from_nodes(&[point_node(prefix, 0)]);
    let right = AstChart::from_nodes(&[point_node(name, usize::from(arity))]);
    let base = match (left.points().first(), right.points().first()) {
        (Some(prefix_point), Some(name_point)) => topological_distance(prefix_point, name_point),
        _ => METRIC_CAP,
    };
    // Los dos puntos se miden en el índice 0. El salto de carta es el mismo
    // término que `topological_distance` suma cuando los índices difieren.
    base.saturating_add(u32::from(focus_index.abs_diff(slot)))
        .min(METRIC_CAP)
}

fn point_node(root: &str, arity: usize) -> ShoreshNode {
    ShoreshNode {
        root: root.chars().take(64).collect(),
        original: root.chars().take(64).collect(),
        arity,
        ret: BaraType::Unknown,
        hazard: 0.0,
        valence: QuantumState::paraconsistent(1.0, 0.0),
        sanitized: false,
    }
}

fn lane_distance(prefix: &str, text: &str) -> u16 {
    let milli = conceptual_milli(embed_root(prefix), embed_root(text)).max(0);
    let positive = u16::try_from(milli).unwrap_or(1000).min(1000);
    1000u16.saturating_sub(positive)
}

fn cohesion_of(focus: &str, shoresh: &str) -> u16 {
    let right = if shoresh.is_empty() { focus } else { shoresh };
    let left = if focus.is_empty() { right } else { focus };
    if left.is_empty() {
        return 1000;
    }
    survey_roots(&[left, right]).cohesion_milli
}

fn dominant_root(cognitive: &[IndexedLabel]) -> &str {
    let mut best = "";
    let mut best_count = 0usize;
    for label in cognitive {
        if label.root.is_empty() {
            continue;
        }
        let count = cognitive
            .iter()
            .filter(|item| item.root == label.root)
            .count();
        let closer = count > best_count
            || (count == best_count && (best.is_empty() || label.root.as_str() < best));
        if closer {
            best = label.root.as_str();
            best_count = count;
        }
    }
    best
}

fn partial_text(prefix: &str, full: &str) -> String {
    if !full.starts_with(prefix) {
        return full.to_string();
    }
    let Some(rest) = full.get(prefix.len()..) else {
        return full.to_string();
    };
    if rest.is_empty() {
        return full.to_string();
    }
    let mut start = 0usize;
    if let Some(first) = rest.chars().next() {
        if first == '_' || first == '.' {
            start = first.len_utf8();
        }
    }
    let tail = rest.get(start..).unwrap_or("");
    let mut end = start;
    for (index, ch) in tail.char_indices() {
        if matches!(ch, ' ' | '(' | '.' | '_') {
            break;
        }
        end = start.saturating_add(index).saturating_add(ch.len_utf8());
    }
    if end == 0 || end >= rest.len() {
        return full.to_string();
    }
    match rest.get(..end) {
        Some(segment) => format!("{prefix}{segment}"),
        None => full.to_string(),
    }
}

fn guard_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    let normalized = normalize_slashes(path);
    let absolute =
        path.chars().nth(1) == Some(':') || normalized.starts_with('/') || path.starts_with('\\');
    if absolute
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("la ruta del autocompletado queda fuera de la carpeta activa".to_string());
    }
    Ok(())
}

fn normalize_prefix(prefix: &str) -> Result<&str, String> {
    if prefix.chars().count() > MAX_PREFIX {
        return Err("el prefijo supera la cota del autocompletado".to_string());
    }
    if prefix.chars().any(|ch| ch.is_control()) {
        return Err("el prefijo no es un token".to_string());
    }
    Ok(prefix)
}

fn normalize_slashes(path: &str) -> String {
    path.replace('\\', "/")
}

fn harvest(root: &str) -> Result<Harvest, String> {
    let canonical = fs::canonicalize(root)
        .map_err(|err| format!("no se pudo leer la carpeta activa: {err}"))?;
    if !canonical.is_dir() {
        return Err("la carpeta activa no es un directorio".to_string());
    }
    let mut files = Vec::new();
    collect_sources(&canonical, &canonical, "", 0, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    files.truncate(MAX_FILES);

    let mut stamp = fnv(FNV_OFFSET, root.as_bytes());
    let mut hits = Vec::new();
    for (relative, path) in files {
        stamp = fnv(stamp, relative.as_bytes());
        let Some(text) = read_capped(&path) else {
            continue;
        };
        stamp = fnv(stamp, text.as_bytes());
        if hits.len() >= MAX_HITS {
            continue;
        }
        absorb(&text, &relative, &mut hits);
    }
    Ok(Harvest { stamp, hits })
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
        if is_excluded(&name) {
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
        } else if is_source(&name) {
            let Ok(canonical_file) = fs::canonicalize(&path) else {
                continue;
            };
            if canonical_file.starts_with(root) {
                out.push((child, canonical_file));
            }
        }
    }
}

fn is_excluded(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "target" | "node_modules" | ".git"
    )
}

fn is_source(name: &str) -> bool {
    let Some(ext) = extension(name) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "bara"
            | "rs"
            | "py"
            | "go"
            | "sol"
            | "c"
            | "h"
            | "cpp"
            | "cc"
            | "hpp"
            | "js"
            | "jsx"
            | "ts"
            | "tsx"
    )
}

fn extension(name: &str) -> Option<&str> {
    let dot = name.rfind('.')?;
    let ext = name.get(dot.saturating_add(1)..)?;
    if ext.is_empty() {
        None
    } else {
        Some(ext)
    }
}

fn absorb(text: &str, relative: &str, hits: &mut Vec<Hit>) {
    if hits.len() >= MAX_HITS {
        return;
    }
    if relative.ends_with(".bara") {
        absorb_bara(text, relative, hits);
        return;
    }
    let Some(language) = language_of(relative) else {
        return;
    };
    for symbol in syntax::parse(language, text).symbols() {
        push_symbol(&symbol, relative, hits);
        if hits.len() >= MAX_HITS {
            break;
        }
    }
}

fn absorb_bara(text: &str, relative: &str, hits: &mut Vec<Hit>) {
    for token in bara_ide::analyze(text).tokens {
        if hits.len() >= MAX_HITS {
            break;
        }
        let kind = match token.class {
            bara_ide::TokenClass::RootKnown => "raíz",
            bara_ide::TokenClass::RootUnknown | bara_ide::TokenClass::Identifier => "ident",
            _ => continue,
        };
        let Some(name) = clean_token(&token.lexeme) else {
            continue;
        };
        let shoresh = token.glyph.unwrap_or(name.as_str()).to_string();
        hits.push(Hit {
            detail: match token.meaning {
                Some(meaning) => format!("raíz · {meaning}"),
                None => kind.to_string(),
            },
            text: name,
            shoresh,
            arity: 0,
            depth: u16::try_from(token.line).unwrap_or(0).min(31),
            file: relative.to_string(),
            kind,
        });
    }
}

fn push_symbol(symbol: &SourceSymbol, relative: &str, hits: &mut Vec<Hit>) {
    let Some(name) = clean_token(&symbol.name) else {
        return;
    };
    let shoresh = match symbol.kind {
        "call" => Concept::Import.root(),
        _ => Concept::Define.root(),
    };
    let label = match symbol.kind {
        "fn" => "fn",
        "type" => "tipo",
        "call" => "llamada",
        _ => symbol.kind,
    };
    let detail = if symbol.parent.is_empty() {
        label.to_string()
    } else {
        format!("{label} · {}", symbol.parent)
    };
    hits.push(Hit {
        text: name,
        detail,
        shoresh: shoresh.to_string(),
        arity: u16::try_from(symbol.arity).unwrap_or(u16::MAX),
        depth: u16::try_from(symbol.depth).unwrap_or(31).min(31),
        file: relative.to_string(),
        kind: match symbol.kind {
            "fn" | "type" | "call" => symbol.kind,
            _ => "ident",
        },
    });
}

fn language_of(relative: &str) -> Option<SourceLanguage> {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    let ext = extension(name)?.to_ascii_lowercase();
    match ext.as_str() {
        "rs" => Some(SourceLanguage::Rust),
        "py" => Some(SourceLanguage::Python),
        "go" => Some(SourceLanguage::Go),
        "sol" => Some(SourceLanguage::Solidity),
        "c" | "h" | "cpp" | "cc" | "hpp" => Some(SourceLanguage::C),
        "js" | "jsx" | "ts" | "tsx" => Some(SourceLanguage::JavaScript),
        _ => None,
    }
}

fn clean_token(text: &str) -> Option<String> {
    if text.is_empty()
        || text.chars().count() > MAX_PREFIX
        || text.chars().any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return None;
    }
    Some(text.chars().take(MAX_PREFIX).collect())
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

fn fnv(hash: u64, bytes: &[u8]) -> u64 {
    let mut acc = hash;
    for byte in bytes {
        acc ^= u64::from(*byte);
        acc = acc.wrapping_mul(FNV_PRIME);
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn label(text: &str, root: &str) -> IndexedLabel {
        IndexedLabel {
            text: text.to_string(),
            root: root.to_string(),
            arity: 1,
            depth: 0,
        }
    }

    #[test]
    fn la_raiz_mas_cercana_es_la_del_catalogo() {
        let mut cache = CompletionCache::new();
        let items = complete(1, "בר", "", "", &[], &mut cache).expect("prefijo");
        assert_eq!(items.first().map(|item| item.text.as_str()), Some("ברא"));
        assert!(items.iter().all(|item| item.distance <= METRIC_CAP));
        assert!(items.iter().all(|item| item.cohesion_milli <= 1000));
    }

    #[test]
    fn el_orden_no_cambia_entre_llamadas() {
        let labels = [label("length", "בנה")];
        let mut cache = CompletionCache::new();
        let first = complete(4, "בר", "", "", &labels, &mut cache).expect("una");
        let second = complete(4, "בר", "", "", &labels, &mut cache).expect("dos");
        assert_eq!(first, second);
    }

    #[test]
    fn el_nombre_indexado_en_la_malla_entra_en_la_lista() {
        let labels = [label("length", "בנה"), label("longitude", "בנה")];
        let mut cache = CompletionCache::new();
        let items = complete(1, "len", "", "", &labels, &mut cache).expect("nombres");
        assert_eq!(items.first().map(|item| item.text.as_str()), Some("length"));
        assert!(items.iter().any(|item| item.detail.contains("malla")));
    }

    #[test]
    fn enter_acepta_el_segmento_y_tab_el_nombre() {
        assert_eq!(partial_text("get", "get_local_name"), "get_local");
        assert_eq!(partial_text("f", "fn "), "fn");
        assert_eq!(partial_text("בר", "ברא"), "ברא");
    }

    #[test]
    fn la_ruta_del_webview_no_reabre_la_jaula() {
        let workspace = crate::workspace::ActiveWorkspace::empty();
        let dir = std::env::temp_dir().join(format!("bara-completar-jaula-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("directorio");
        let root = crate::workspace::resolve_root(dir.to_str().expect("utf-8"))
            .expect("canon")
            .display()
            .to_string();
        let _ = workspace.set(root.clone());
        let before = workspace.get().expect("activa");
        let mut cache = CompletionCache::new();
        assert!(complete(1, "fn", r"C:\Windows", &before, &[], &mut cache).is_err());
        assert!(complete(1, "fn", "../fuera.rs", &before, &[], &mut cache).is_err());
        assert_eq!(workspace.get().expect("sigue"), before);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn el_indice_no_lee_fuera_de_la_carpeta_activa() {
        let root = std::env::temp_dir().join(format!("bara-completar-raiz-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("bara-completar-fuera-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&root).expect("raíz");
        fs::create_dir_all(&outside).expect("fuera");
        fs::write(
            root.join("lib.rs"),
            "fn alpha() {}\nfn beta() {}\nfn gamma() {}\nfn get_local_name() {}\n",
        )
        .expect("fuente");
        fs::write(outside.join("lib.rs"), "fn zeta_secret() {}\n").expect("ajena");
        let canonical = fs::canonicalize(&root)
            .expect("canon")
            .display()
            .to_string();
        let mut cache = CompletionCache::new();
        let leaked = complete(1, "zeta", "lib.rs", &canonical, &[], &mut cache).expect("zeta");
        assert!(
            leaked.iter().all(|item| !item.text.contains("zeta")),
            "un archivo hermano de la carpeta no es una sugerencia"
        );
        let names = complete(1, "alp", "lib.rs", &canonical, &[], &mut cache).expect("alpha");
        assert_eq!(names.first().map(|item| item.text.as_str()), Some("alpha"));
        let partial = complete(1, "get", "lib.rs", &canonical, &[], &mut cache).expect("get");
        let found = partial.iter().find(|item| item.text == "get_local_name");
        assert_eq!(found.map(|item| item.partial.as_str()), Some("get_local"));
        let again = complete(1, "alp", "lib.rs", &canonical, &[], &mut cache).expect("caliente");
        assert_eq!(again, names);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn el_rango_caliente_cabe_en_diez_milisegundos() {
        let hits: Vec<Hit> = (0..80)
            .map(|index| Hit {
                text: format!("nombre{index}"),
                detail: "fn".to_string(),
                shoresh: Concept::Define.root().to_string(),
                arity: 1,
                depth: u16::try_from(index % 32).unwrap_or(0),
                file: "a.rs".to_string(),
                kind: "fn",
            })
            .collect();
        let _ = rank(1, "nom", "a.rs", &hits, &[]);
        let started = Instant::now();
        let items = rank(1, "nom", "a.rs", &hits, &[]);
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_millis(10),
            "el rango tardó {elapsed:?}"
        );
        assert!(!items.is_empty());
    }

    #[test]
    fn el_modulo_no_abre_la_red() {
        let src = include_str!("completion.rs");
        let production = src.split("mod tests").next().unwrap_or(src);
        let lower = production.to_ascii_lowercase();
        assert!(!lower.contains("tcpstream"));
        assert!(!lower.contains("reqwest"));
        assert!(!lower.contains("fetch("));
        assert!(!production.contains("https://"));
        assert!(!production.contains("Command::new"));
    }
}
