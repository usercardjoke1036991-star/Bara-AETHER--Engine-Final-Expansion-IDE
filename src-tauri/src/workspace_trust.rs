//! M5 — Workspace Trust: rutas canónicas confiadas por el proceso.
//!
//! Persistencia en disco del proceso (no `localStorage`). Sin confianza no
//! se spawnea ninguna receta (`orchestrate::run`).

#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::workspace::{normalize_root_key, path_to_api, resolve_root};

/// Mensaje estable cuando la carpeta no está en el almacén de confianza.
pub const UNTRUSTED_MSG: &str =
    "carpeta no confiada: confirma «¿Confías en esta carpeta?» antes de ejecutar recetas";

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    #[serde(default)]
    trusted: Vec<String>,
}

struct Inner {
    keys: BTreeSet<String>,
    display: BTreeSet<String>,
    file: Option<PathBuf>,
}

/// Almacén de confianza del proceso. Clone barato (`Arc`).
#[derive(Clone)]
pub struct TrustStore {
    inner: Arc<Mutex<Inner>>,
}

impl TrustStore {
    /// Carga el fichero por defecto junto a los datos de la app.
    pub fn load_default() -> Self {
        Self::load_from(Some(default_path()))
    }

    /// Pruebas: sin fichero (sólo memoria).
    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self::load_from(None)
    }

    /// Pruebas: fichero temporal explícito.
    #[cfg(test)]
    pub fn load_from_path(path: PathBuf) -> Self {
        Self::load_from(Some(path))
    }

    fn load_from(file: Option<PathBuf>) -> Self {
        let mut keys = BTreeSet::new();
        let mut display = BTreeSet::new();
        if let Some(ref path) = file {
            if let Ok(raw) = fs::read_to_string(path) {
                if let Ok(parsed) = serde_json::from_str::<TrustFile>(&raw) {
                    for entry in parsed.trusted {
                        let key = normalize_root_key(&entry);
                        if key.is_empty() {
                            continue;
                        }
                        display.insert(entry);
                        keys.insert(key);
                    }
                }
            }
        }
        Self {
            inner: Arc::new(Mutex::new(Inner {
                keys,
                display,
                file,
            })),
        }
    }

    /// ¿La ruta canónica (o su forma API) está confiada?
    pub fn is_trusted(&self, path: &Path) -> bool {
        let api = path_to_api(path);
        let key = normalize_root_key(&api);
        self.inner
            .lock()
            .map(|guard| guard.keys.contains(&key))
            .unwrap_or(false)
    }

    /// Exige confianza o error claro (cero spawn).
    pub fn require(&self, path: &Path) -> Result<(), String> {
        if self.is_trusted(path) {
            Ok(())
        } else {
            Err(UNTRUSTED_MSG.to_string())
        }
    }

    /// Lista rutas mostrables (forma API), ordenadas.
    pub fn list(&self) -> Vec<String> {
        self.inner
            .lock()
            .map(|guard| guard.display.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Marca una carpeta como confiada (canoniza antes).
    pub fn trust(&self, path: &str) -> Result<String, String> {
        let canonical = resolve_root(path.trim())?;
        let api = path_to_api(&canonical);
        let key = normalize_root_key(&api);
        if key.is_empty() {
            return Err("la ruta de confianza no es válida".to_string());
        }
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "el almacén de confianza no está disponible".to_string())?;
        guard.keys.insert(key);
        guard.display.insert(api.clone());
        self.persist_locked(&guard)?;
        Ok(api)
    }

    /// Quita la confianza de una ruta (exacta o canónica equivalente).
    pub fn revoke(&self, path: &str) -> Result<(), String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("falta la ruta a revocar".to_string());
        }
        let key = match resolve_root(trimmed) {
            Ok(canonical) => normalize_root_key(&path_to_api(&canonical)),
            Err(_) => normalize_root_key(trimmed),
        };
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "el almacén de confianza no está disponible".to_string())?;
        guard.keys.remove(&key);
        guard
            .display
            .retain(|entry| normalize_root_key(entry) != key);
        self.persist_locked(&guard)?;
        Ok(())
    }

    fn persist_locked(&self, guard: &Inner) -> Result<(), String> {
        let Some(ref path) = guard.file else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "no se pudo crear el directorio de confianza".to_string())?;
        }
        let payload = TrustFile {
            trusted: guard.display.iter().cloned().collect(),
        };
        let text = serde_json::to_string_pretty(&payload)
            .map_err(|_| "no se pudo serializar la confianza".to_string())?;
        fs::write(path, text).map_err(|_| "no se pudo guardar la confianza".to_string())
    }
}

fn default_path() -> PathBuf {
    // Datos del proceso (no el WebView). En Windows: %LOCALAPPDATA%\bara-ide-desktop\
    if let Ok(base) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(base)
            .join("bara-ide-desktop")
            .join("workspace-trust.json");
    }
    if let Ok(base) = std::env::var("XDG_DATA_HOME") {
        return PathBuf::from(base)
            .join("bara-ide-desktop")
            .join("workspace-trust.json");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("bara-ide-desktop")
            .join("workspace-trust.json");
    }
    std::env::temp_dir().join("bara-ide-desktop-workspace-trust.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(tag: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bara-trust-{tag}-{nonce}"));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn sin_confianza_require_falla() {
        let store = TrustStore::in_memory();
        let dir = scratch("deny");
        assert!(store.require(&dir).is_err());
        assert!(!store.is_trusted(&dir));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn confiar_y_revocar_persisten() {
        let file = scratch("file").join("trust.json");
        let store = TrustStore::load_from_path(file.clone());
        let dir = scratch("ok");
        let api = store.trust(dir.to_str().expect("utf8")).expect("trust");
        assert!(store.is_trusted(&dir));
        assert!(store.require(&dir).is_ok());
        assert!(store.list().iter().any(|p| p == &api));

        let reloaded = TrustStore::load_from_path(file.clone());
        assert!(reloaded.is_trusted(&dir));

        reloaded.revoke(&api).expect("revoke");
        assert!(!reloaded.is_trusted(&dir));
        assert!(reloaded.require(&dir).is_err());

        let again = TrustStore::load_from_path(file);
        assert!(!again.is_trusted(&dir));
        let _ = fs::remove_dir_all(dir);
    }
}
