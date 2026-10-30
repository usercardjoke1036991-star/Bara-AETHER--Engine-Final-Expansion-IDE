//! Salvaguarda de markup de herramientas (DSML / tool_call) en texto.
//!
//! La ejecución nativa vive en el WebView (`tools.ts` + IPC). Este módulo
//! replica el saneado mínimo para pruebas Rust y usos futuros en el host.

#![forbid(unsafe_code)]

/// Aviso cuando el modelo filtró markup y no se pudo recuperar la llamada.
pub const TOOL_LEAK_NOTICE: &str = "el modelo intentó usar una herramienta y falló";

/// ¿El texto parece una fuga de DSML / tool_call?
pub fn looks_like_tool_leak(text: &str) -> bool {
    let sample = if text.len() > 4000 { &text[..4000] } else { text };
    let lower = sample.to_ascii_lowercase();
    lower.contains("dsml")
        || lower.contains("<tool_call")
        || lower.contains("</tool_call")
        || lower.contains("<function_call")
        || lower.contains("invoke name=")
        || lower.contains("|dsml|")
}

/// Intenta sacar `path` de un bloque DSML / invoke de «leer archivo».
pub fn parse_dsml_read_path(text: &str) -> Option<String> {
    if !looks_like_tool_leak(text) {
        return None;
    }
    // parameter name="path" …>ruta
    if let Some(idx) = find_ci(text, "name=\"path\"") {
        let after = &text[idx + "name=\"path\"".len()..];
        if let Some(gt) = after.find('>') {
            let rest = &after[gt + 1..];
            let end = rest.find('<').unwrap_or(rest.len().min(200));
            let path = rest[..end].trim();
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }
    // Cualquier *.bara cerca de «leer»
    if find_ci(text, "leer").is_some() {
        if let Some(path) = extract_bara_path(text) {
            return Some(path);
        }
    }
    None
}

/// Quita markup; si no queda prosa útil, el aviso fijo.
pub fn sanitize_tool_leak(text: &str) -> String {
    if !looks_like_tool_leak(text) {
        return text.to_string();
    }
    if parse_dsml_read_path(text).is_some() {
        // Quien llame puede ejecutar la herramienta; aquí sólo ocultamos el crudo.
        return TOOL_LEAK_NOTICE.to_string();
    }
    TOOL_LEAK_NOTICE.to_string()
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    hay.to_ascii_lowercase().find(&needle.to_ascii_lowercase())
}

fn extract_bara_path(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let idx = lower.find(".bara")?;
    let start = text[..idx]
        .rfind(|c: char| !(c.is_alphanumeric() || c == '_' || c == '/' || c == '\\' || c == '.' || c == '-'))
        .map(|i| i + 1)
        .unwrap_or(0);
    let end = idx + ".bara".len();
    let path = text[start..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_calls_nativos_no_son_fuga() {
        let ok = "Aquí va el programa:\n```bara\nברא\n```";
        assert!(!looks_like_tool_leak(ok));
        assert_eq!(sanitize_tool_leak(ok), ok);
    }

    #[test]
    fn dsml_en_texto_se_oculta_y_extrae_path() {
        let dsml = r#"<|DSML| calls><|DSML| invoke name="leer archivo"><|DSML| parameter name="path" string="true">hELLO.bara</parameter></invoke></calls>"#;
        assert!(looks_like_tool_leak(dsml));
        assert_eq!(
            parse_dsml_read_path(dsml).as_deref(),
            Some("hELLO.bara")
        );
        assert_eq!(sanitize_tool_leak(dsml), TOOL_LEAK_NOTICE);
        assert!(!sanitize_tool_leak(dsml).contains("DSML"));
    }
}
