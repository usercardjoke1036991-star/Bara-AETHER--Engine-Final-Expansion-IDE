//! Contexto del editor de `main` para las ventanas de asistencia.
//!
//! El WebView de asistencia no comparte el estado React de `main`. Este puente
//! guarda el último documento publicado (ruta, fuente, análisis) y lo emite
//! para que `ai-workspace` se actualice al cambiar de pestaña o al guardar.
//! La clave de API nunca entra aquí.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Instantánea del documento activo en el editor principal.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    /// Ruta relativa o etiqueta (`samples/Hello.bara`, `<editor>`).
    pub path: String,
    /// Nombre visible del archivo.
    pub name: String,
    /// Fuente completa (el front recorta al armar el prompt).
    pub source: String,
    /// Análisis léxico del kernel, si ya existe.
    pub analysis: Option<Value>,
    /// Árbol resumido de la carpeta abierta (texto).
    pub tree_outline: String,
}

/// Almacén del último contexto publicado.
#[derive(Default)]
pub struct EditorBridge {
    latest: Mutex<EditorSnapshot>,
}

impl EditorBridge {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn publish(
        &self,
        app: &AppHandle,
        snapshot: EditorSnapshot,
    ) -> Result<EditorSnapshot, String> {
        {
            let mut guard = self
                .latest
                .lock()
                .map_err(|_| "el puente del editor no está disponible".to_string())?;
            *guard = snapshot.clone();
        }
        let _ = app.emit("editor-context", &snapshot);
        Ok(snapshot)
    }

    pub fn get(&self) -> Result<EditorSnapshot, String> {
        self.latest
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| "el puente del editor no está disponible".to_string())
    }
}
