//! Hilo de reposo. Duerme entre pasadas y sólo lee la carpeta activa.
//! No escribe: la transmutación la confirma el cockpit. Un cerrojo envenenado
//! se ignora y el hilo sigue en la siguiente pausa.

#![forbid(unsafe_code)]

use std::thread;
use std::time::Duration;

use bara::idle_audit;
use bara::transmute_engine::language_of_extension;
use serde::Serialize;
use tauri::Manager;

use crate::graph;
use crate::workspace::{self, ActiveWorkspace};

/// Aviso que el cockpit muestra sin tapar el editor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleNotice {
    pub path: String,
    pub name: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct IdleSlot {
    notice: Option<IdleNotice>,
}

impl IdleSlot {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current(&self) -> Option<IdleNotice> {
        self.notice.clone()
    }

    pub fn clear(&mut self) {
        self.notice = None;
    }

    fn store(&mut self, notice: IdleNotice) {
        if self.notice.is_none() {
            self.notice = Some(notice);
        }
    }
}

/// Arranca un solo hilo. Cada pasada espera cinco segundos antes de leer.
pub fn start(handle: tauri::AppHandle) {
    let _ = thread::Builder::new()
        .name("bara-idle".to_string())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            scan_once(&handle);
        });
}

fn scan_once(handle: &tauri::AppHandle) {
    let workspace = handle.state::<ActiveWorkspace>();
    let Ok(root) = workspace.get() else {
        return;
    };
    let slot = handle.state::<std::sync::Mutex<IdleSlot>>();
    let pending = slot
        .lock()
        .ok()
        .and_then(|guard| guard.current())
        .is_some();
    if pending {
        if seek(&root).is_none() {
            let locked = slot.lock();
            if let Ok(mut guard) = locked {
                guard.clear();
            }
        }
        return;
    }
    let Some(notice) = seek(&root) else {
        return;
    };
    if let Ok(mut guard) = slot.lock() {
        guard.store(notice);
    };
}

/// Primera redundancia limpia de la carpeta, con el mismo tope de archivos que el grafo.
pub fn seek(root: &str) -> Option<IdleNotice> {
    let graph = graph::build(root).ok()?;
    for node in graph.nodes.iter().filter(|node| node.kind == "file") {
        let Ok(document) = workspace::read_text(root, &node.path) else {
            continue;
        };
        let ext = node.path.rsplit('.').next().unwrap_or("");
        let Some(proposal) = idle_audit::propose(language_of_extension(ext), &document.source) else {
            continue;
        };
        return Some(IdleNotice {
            path: document.path.clone(),
            name: proposal.name,
            message: format!(
                "Se ha detectado una optimización estructural en {}; ¿deseas transmutar?",
                document.path
            ),
        });
    }
    None
}

/// Vuelve a juzgar el archivo y escribe sólo si la propuesta sigue en `∅`.
pub fn apply(root: &str, notice: &IdleNotice) -> Result<bool, String> {
    let document = workspace::read_text(root, &notice.path)?;
    let ext = notice.path.rsplit('.').next().unwrap_or("");
    let Some(proposal) = idle_audit::propose(language_of_extension(ext), &document.source) else {
        return Ok(false);
    };
    if proposal.name != notice.name {
        return Ok(false);
    }
    workspace::write_source(root, &notice.path, &proposal.revised)?;
    Ok(true)
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
        let dir = std::env::temp_dir().join(format!("bara-idle-{nonce}"));
        fs::create_dir_all(dir.join("src")).expect("src");
        dir
    }

    #[test]
    fn el_reposo_propone_y_solo_entonces_escribe() {
        let root = scratch();
        fs::write(root.join("src/caja.rs"), "fn alpha() {}\nfn alpha() {}\n").expect("caja");
        let root_text = root.display().to_string();
        let notice = seek(&root_text).expect("aviso");
        assert!(notice.message.contains("src/caja.rs"));
        assert!(notice.message.contains("¿deseas transmutar?"));
        assert!(apply(&root_text, &notice).expect("aplicar"));
        let disk = fs::read_to_string(root.join("src/caja.rs")).expect("disco");
        assert_eq!(disk.matches("fn alpha()").count(), 1);
        fs::write(root.join("src/caja.rs"), "fn alpha() {}\nfn beta() {}\n").expect("limpio");
        assert!(seek(&root_text).is_none());
    }

    #[test]
    fn el_modulo_no_escribe_desde_el_hilo_de_arranque() {
        let source = include_str!("idle_worker.rs");
        let production = source.split("mod tests").next().unwrap_or(source);
        let thread_half = production.split("pub fn seek").next().unwrap_or(production);
        assert!(!thread_half.contains("write_source"));
        assert!(!production.contains("Command::new"));
        assert!(!production.contains("https://"));
    }
}
