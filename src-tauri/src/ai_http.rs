//! Llamadas a los proveedores de chat.
//!
//! La clave no viaja en el argumento que vuelve al WebView. El destino es una
//! lista cerrada: los tres hosts oficiales, o HTTP sólo en la máquina local.

#![forbid(unsafe_code)]

use std::time::Duration;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const BODY_CAP: usize = 12 * 1024 * 1024;

/// Respuesta ya limpia. `body` no contiene la clave.
#[derive(serde::Serialize)]
pub struct Exchange {
    pub status: u16,
    pub body: String,
}

/// Host al que este proceso puede enviar la clave.
pub fn destino_permitido(url: &str) -> bool {
    let (scheme, rest) = if let Some(rest) = url.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = url.strip_prefix("http://") {
        ("http", rest)
    } else {
        return false;
    };
    if rest.contains('@') || rest.is_empty() {
        return false;
    }
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    match scheme {
        "https" => matches!(
            host,
            "api.anthropic.com" | "api.openai.com" | "api.deepseek.com"
        ),
        "http" => matches!(host, "localhost" | "127.0.0.1"),
        _ => false,
    }
}

fn redactar(text: &str, secret: &str) -> String {
    if secret.is_empty() {
        return text.to_string();
    }
    text.replace(secret, "••••")
}

/// Cabeceras de autorización. El valor no se devuelve al WebView.
fn cabeceras(provider: &str, secret: &str) -> Result<Vec<(&'static str, String)>, String> {
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("no hay clave para este proveedor".to_string());
    }
    match provider.trim() {
        "anthropic" => Ok(vec![
            ("x-api-key", secret.to_string()),
            ("anthropic-version", ANTHROPIC_VERSION.to_string()),
        ]),
        "openai" => Ok(vec![("authorization", format!("Bearer {secret}"))]),
        _ => Err("el proveedor no tiene transporte".to_string()),
    }
}

/// Envía la petición. Un host fuera de la lista no sale de este proceso.
pub fn exchange(
    provider: &str,
    url: &str,
    method: &str,
    body: &str,
    secret: &str,
) -> Result<Exchange, String> {
    let method = method.trim().to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Err("el método no está en el catálogo".to_string());
    }
    if !destino_permitido(url) {
        return Err("el destino no está en la lista del transporte".to_string());
    }
    if body.len() > BODY_CAP {
        return Err("la petición supera el tope".to_string());
    }
    let headers = cabeceras(provider, secret)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(90))
        .build();
    let mut request = agent.request(&method, url);
    for (name, value) in &headers {
        request = request.set(name, value);
    }
    let sent = if method == "GET" {
        request.call()
    } else {
        request
            .set("content-type", "application/json")
            .send_string(body)
    };
    let (status, text) = match sent {
        Ok(response) => {
            let status = response.status();
            let text = response.into_string().unwrap_or_default();
            (status, text)
        }
        Err(ureq::Error::Status(status, response)) => {
            let text = response.into_string().unwrap_or_default();
            (status, text)
        }
        Err(_) => return Err("sin respuesta del servidor".to_string()),
    };
    Ok(Exchange {
        status,
        body: redactar(&text, secret.trim()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_lista_de_destinos_esta_cerrada() {
        assert!(destino_permitido("https://api.anthropic.com/v1/messages"));
        assert!(destino_permitido(
            "https://api.openai.com/v1/chat/completions"
        ));
        assert!(destino_permitido(
            "https://api.deepseek.com/v1/chat/completions"
        ));
        assert!(destino_permitido("http://127.0.0.1:11434/v1/models"));
        assert!(destino_permitido("http://localhost/v1/models"));
        assert!(!destino_permitido("https://api.example/v1/messages"));
        assert!(!destino_permitido("https://evil.api.openai.com/v1"));
        assert!(!destino_permitido("https://user:clave@api.openai.com/v1"));
        assert!(!destino_permitido("http://api.openai.com/v1"));
        assert!(!destino_permitido("file:///tmp"));
    }

    #[test]
    fn la_cabecera_no_viaja_en_el_cuerpo_devuelto() {
        let headers = cabeceras("anthropic", "clave-de-prueba").expect("anthropic");
        assert_eq!(headers[0].0, "x-api-key");
        assert_eq!(headers[0].1, "clave-de-prueba");
        assert!(headers.iter().all(|(name, _)| *name != "authorization"));
        let openai = cabeceras("openai", "clave-de-prueba").expect("openai");
        assert_eq!(openai[0].1, "Bearer clave-de-prueba");
        assert_eq!(
            redactar("invalid clave-de-prueba", "clave-de-prueba"),
            "invalid ••••"
        );
        assert!(cabeceras("otro", "x").is_err());
        assert!(exchange("anthropic", "https://api.example/v1", "POST", "{}", "x").is_err());
    }
}
