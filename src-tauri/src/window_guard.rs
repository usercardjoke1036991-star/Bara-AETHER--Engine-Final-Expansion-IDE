//! Segunda capa: el comando comprueba la etiqueta de la ventana aunque la
//! capability ya filtre el IPC. Un WebView no declarado no entra.

#![forbid(unsafe_code)]

/// Ventanas que alojan el chat y pueden tocar el llavero o `ai_exchange`.
pub const CHAT: &[&str] = &["main", "ai-workspace"];

/// Escritura de documentos `.bara` del workspace (principal y asistencia).
pub const WRITE: &[&str] = &["main", "ai-workspace"];

/// Sólo la ventana principal clona, lanza recetas o abre escritorios.
pub const MAIN: &[&str] = &["main"];

/// El aviso de reposo se confirma desde el cockpit (principal o telemetría).
pub const IDLE_APPLY: &[&str] = &["main", "telemetry"];

/// Devuelve error en español si la ventana no está en la lista.
pub fn require(window: &tauri::WebviewWindow, allowed: &[&str]) -> Result<(), String> {
    let label = window.label();
    if allowed.contains(&label) {
        return Ok(());
    }
    Err(format!(
        "la ventana «{label}» no tiene permiso para este comando"
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn el_chat_cubre_main_y_asistencia() {
        assert!(super::CHAT.contains(&"main"));
        assert!(super::CHAT.contains(&"ai-workspace"));
        assert!(!super::CHAT.contains(&"topology"));
        assert!(!super::CHAT.contains(&"telemetry"));
        assert!(!super::CHAT.contains(&"autopoiesis"));
    }

    #[test]
    fn la_escritura_cubre_main_y_asistencia() {
        assert!(super::WRITE.contains(&"main"));
        assert!(super::WRITE.contains(&"ai-workspace"));
        assert!(!super::WRITE.contains(&"topology"));
    }

    #[test]
    fn las_recetas_y_el_clon_quedan_en_main() {
        assert_eq!(super::MAIN, &["main"]);
        assert!(!super::MAIN.contains(&"ai-workspace"));
    }

    #[test]
    fn el_reposo_confirma_desde_el_cockpit() {
        assert!(super::IDLE_APPLY.contains(&"main"));
        assert!(super::IDLE_APPLY.contains(&"telemetry"));
        assert!(!super::IDLE_APPLY.contains(&"topology"));
    }
}
