//! Propagación de un nombre por el grafo de la carpeta activa.
//!
//! Primero se reescriben en memoria todos los archivos que citan el identificador.
//! El bilátice une los veredictos. Sólo si la red no contiene `⊤∧⊥` se escribe,
//! y un fallo a medias restaura lo ya guardado.

#![forbid(unsafe_code)]

use bara::autopoietic::BelnapValue;
use bara::log_lattice::status_key;
use bara::syntax;
use bara::transmute_engine::language_of_extension;
use serde::Serialize;

use crate::graph;
use crate::workspace;

const MAX_NAME: usize = 64;

/// Un archivo juzgado. `changed` indica que el identificador aparecía.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalFile {
    pub path: String,
    pub glyph: String,
    pub status: String,
    pub changed: bool,
}

/// Resultado de la red. `applied` es cierto sólo tras escribir todos.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalReport {
    pub glyph: String,
    pub status: String,
    pub applied: bool,
    pub from_name: String,
    pub to_name: String,
    pub files: Vec<GlobalFile>,
}

fn ident(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(ch) if ch.is_ascii_alphabetic() || ch == '_' => {}
        _ => return false,
    }
    name.len() <= MAX_NAME && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn replace_ident(source: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while !rest.is_empty() {
        if rest.starts_with('"') || rest.starts_with('\'') {
            let quote = rest.chars().next().unwrap_or('"');
            out.push(quote);
            rest = &rest[quote.len_utf8()..];
            while let Some(ch) = rest.chars().next() {
                out.push(ch);
                rest = &rest[ch.len_utf8()..];
                if ch == '\\' {
                    if let Some(escaped) = rest.chars().next() {
                        out.push(escaped);
                        rest = &rest[escaped.len_utf8()..];
                    }
                    continue;
                }
                if ch == quote {
                    break;
                }
            }
            continue;
        }
        if rest.starts_with("//") {
            let end = rest.find('\n').unwrap_or(rest.len());
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        if rest.starts_with("/*") {
            let end = rest
                .find("*/")
                .map_or(rest.len(), |at| at.saturating_add(2));
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        let ch = rest.chars().next().unwrap_or('\0');
        if ch.is_ascii_alphabetic() || ch == '_' {
            let end = rest
                .char_indices()
                .take_while(|(_, item)| item.is_ascii_alphanumeric() || *item == '_')
                .last()
                .map(|(index, item)| index + item.len_utf8())
                .unwrap_or(ch.len_utf8());
            let word = &rest[..end];
            if word == from {
                out.push_str(to);
            } else {
                out.push_str(word);
            }
            rest = &rest[end..];
            continue;
        }
        out.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    out
}

fn owns_declaration(source: &str, path: &str, name: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("");
    let tree = syntax::parse(language_of_extension(ext), source);
    tree.symbols()
        .into_iter()
        .any(|symbol| symbol.kind != "call" && symbol.name == name)
}

fn file_value(source: &str, path: &str, to_name: &str) -> BelnapValue {
    let ext = path.rsplit('.').next().unwrap_or("");
    let tree = syntax::parse(language_of_extension(ext), source);
    if !tree.balanced {
        return BelnapValue::Both;
    }
    let copies = tree
        .symbols()
        .into_iter()
        .filter(|symbol| symbol.kind != "call" && symbol.name == to_name)
        .count();
    if copies > 1 {
        BelnapValue::Both
    } else {
        BelnapValue::Neither
    }
}

struct Planned {
    path: String,
    previous: String,
    next: String,
    value: BelnapValue,
}

/// Propaga `from` → `to` en la carpeta activa. `path` vacío mira toda la red.
pub fn propagate(root: &str, path: &str, from: &str, to: &str) -> Result<GlobalReport, String> {
    if !ident(from) || !ident(to) || from == to {
        return Err("los nombres tienen que ser identificadores distintos".to_string());
    }
    if path.len() > 512 {
        return Err("la ruta queda fuera de la cota".to_string());
    }
    let graph = graph::build(root)?;
    let origin = path.replace('\\', "/");
    if !origin.is_empty() {
        let source = workspace::read_text(root, &origin)?;
        if !owns_declaration(&source.source, &origin, from) {
            return Ok(report(from, to, BelnapValue::False, false, Vec::new()));
        }
    }
    let mut plans = Vec::new();
    let mut network = BelnapValue::Neither;
    let mut seen = false;
    for node in graph.nodes.iter().filter(|node| node.kind == "file") {
        if plans.len() == 48 {
            break;
        }
        let document = match workspace::read_text(root, &node.path) {
            Ok(document) => document,
            Err(_) => continue,
        };
        let next = replace_ident(&document.source, from, to);
        if next == document.source {
            continue;
        }
        seen = true;
        let value = file_value(&next, &node.path, to);
        network = network.union(value);
        plans.push(Planned {
            path: document.path,
            previous: document.source,
            next,
            value,
        });
    }
    if !seen {
        return Ok(report(from, to, BelnapValue::False, false, Vec::new()));
    }
    let files: Vec<GlobalFile> = plans
        .iter()
        .map(|plan| GlobalFile {
            path: plan.path.clone(),
            glyph: plan.value.glyph().to_string(),
            status: status_key(plan.value).to_string(),
            changed: true,
        })
        .collect();
    if network == BelnapValue::Both {
        return Ok(report(from, to, network, false, files));
    }
    let mut written: Vec<(String, String)> = Vec::new();
    for plan in &plans {
        if let Err(err) = workspace::write_source(root, &plan.path, &plan.next) {
            for (path, previous) in written.iter().rev() {
                let _ = workspace::write_source(root, path, previous);
            }
            return Err(err);
        }
        written.push((plan.path.clone(), plan.previous.clone()));
    }
    Ok(report(from, to, network, true, files))
}

fn report(
    from: &str,
    to: &str,
    value: BelnapValue,
    applied: bool,
    files: Vec<GlobalFile>,
) -> GlobalReport {
    GlobalReport {
        glyph: value.glyph().to_string(),
        status: status_key(value).to_string(),
        applied,
        from_name: from.to_string(),
        to_name: to.to_string(),
        files,
    }
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
        let dir = std::env::temp_dir().join(format!("bara-global-{nonce}"));
        fs::create_dir_all(dir.join("src")).expect("src");
        dir
    }

    #[test]
    fn la_red_limpia_renombra_y_la_contradiccion_no_escribe() {
        let root = scratch();
        fs::write(
            root.join("src/a.rs"),
            "fn alpha() {}\nfn main() { alpha(); }\n",
        )
        .expect("a");
        fs::write(root.join("src/b.rs"), "fn otro() { alpha(); }\n").expect("b");
        let root_text = root.display().to_string();
        let clean = propagate(&root_text, "src/a.rs", "alpha", "beta").expect("limpio");
        assert!(clean.applied);
        assert_eq!(clean.glyph, "∅");
        let a = fs::read_to_string(root.join("src/a.rs")).expect("a2");
        let b = fs::read_to_string(root.join("src/b.rs")).expect("b2");
        assert!(a.contains("fn beta()"));
        assert!(a.contains("beta();"));
        assert!(b.contains("beta();"));
        assert!(!a.contains("alpha"));
        fs::write(root.join("src/a.rs"), "fn alpha() {}\nfn beta() {}\n").expect("choque");
        let clash = propagate(&root_text, "src/a.rs", "alpha", "beta").expect("veto");
        assert!(!clash.applied);
        assert_eq!(clash.glyph, "⊤∧⊥");
        let disk = fs::read_to_string(root.join("src/a.rs")).expect("disco");
        assert!(disk.contains("fn alpha()"));
    }

    #[test]
    fn una_cadena_no_cambia_y_el_escape_se_rechaza() {
        let replaced = replace_ident("fn alpha() { let s = \"alpha\"; }\n", "alpha", "beta");
        assert!(replaced.contains("\"alpha\""));
        assert!(replaced.contains("fn beta()"));
        let root = scratch();
        fs::write(root.join("src/a.rs"), "fn alpha() {}\n").expect("a");
        assert!(propagate(&root.display().to_string(), "../a.rs", "alpha", "beta").is_err());
    }
}
