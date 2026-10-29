//! Llamadas a los proveedores de chat.
//!
//! La clave no viaja en el argumento que vuelve al WebView. El destino es una
//! lista cerrada: los tres hosts oficiales, o HTTP sólo en la máquina local.

#![forbid(unsafe_code)]

use std::time::Duration;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const BODY_CAP: usize = 12 * 1024 * 1024;
const TIMEOUT_SECS: u64 = 90;

/// Respuesta ya limpia. `body` no contiene la clave.
#[derive(Debug, serde::Serialize)]
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
        // OpenAI y compatibles (DeepSeek, Ollama local, …) usan Bearer.
        "openai" => Ok(vec![("authorization", format!("Bearer {secret}"))]),
        _ => Err("el proveedor no tiene transporte".to_string()),
    }
}

/// Traduce fallos de transporte de `ureq` a mensajes claros en español.
fn error_de_transporte(error: &ureq::Error) -> String {
    let text = error.to_string();
    let lower = text.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return "tiempo de espera agotado al hablar con el proveedor".to_string();
    }
    if lower.contains("dns")
        || lower.contains("name resolution")
        || lower.contains("getaddrinfo")
        || lower.contains("no such host")
    {
        return "sin red: no se pudo resolver el host del proveedor".to_string();
    }
    if lower.contains("connection refused")
        || lower.contains("actively refused")
        || lower.contains("connection reset")
    {
        return "sin red: el proveedor rechazó o cortó la conexión".to_string();
    }
    if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("handshake")
    {
        return "fallo TLS al conectar con el proveedor".to_string();
    }
    if lower.contains("failed to lookup") || lower.contains("network") {
        return "sin red: no hay camino hasta el proveedor".to_string();
    }
    format!("sin respuesta del servidor ({text})")
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
        return Err("host no permitido: el destino no está en la lista del transporte".to_string());
    }
    if body.len() > BODY_CAP {
        return Err("la petición supera el tope".to_string());
    }
    let headers = cabeceras(provider, secret)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
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
        Err(error) => {
            let mapped = error_de_transporte(&error);
            #[cfg(test)]
            {
                return Err(format!("{mapped} :: {error}"));
            }
            #[cfg(not(test))]
            {
                return Err(mapped);
            }
        }
    };
    Ok(Exchange {
        status,
        body: redactar(&text, secret.trim()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn la_lista_de_destinos_esta_cerrada() {
        assert!(destino_permitido("https://api.anthropic.com/v1/messages"));
        assert!(destino_permitido(
            "https://api.openai.com/v1/chat/completions"
        ));
        assert!(destino_permitido(
            "https://api.deepseek.com/chat/completions"
        ));
        assert!(destino_permitido(
            "https://api.deepseek.com/v1/chat/completions"
        ));
        assert!(destino_permitido("https://api.deepseek.com/models"));
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
        let blocked = exchange("anthropic", "https://api.example/v1", "POST", "{}", "x");
        assert!(blocked
            .expect_err("host ajeno")
            .contains("host no permitido"));
    }

    #[test]
    fn el_mock_local_responde_y_no_filtra_la_clave() {
        use std::net::Shutdown;
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
        let server = thread::spawn(move || {
            ready_tx.send(()).expect("ready");
            let (mut stream, _) = listener.accept().expect("accept");
            let mut data = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        data.extend_from_slice(&buf[..n]);
                        if data.windows(4).any(|window| window == b"\r\n\r\n") {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let body = r#"{"error":{"message":"clave-secreta-xyz inválida"}}"#;
            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            let _ = stream.shutdown(Shutdown::Write);
            thread::sleep(Duration::from_millis(50));
        });
        ready_rx.recv().expect("servidor listo");
        let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
        let result = exchange("openai", &url, "POST", "{}", "clave-secreta-xyz").expect("exchange");
        assert_eq!(result.status, 401);
        assert!(!result.body.contains("clave-secreta-xyz"));
        assert!(result.body.contains("••••"));
        server.join().expect("server");
    }
}
