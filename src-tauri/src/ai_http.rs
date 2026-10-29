//! Llamadas a los proveedores de chat.
//!
//! La clave no viaja en el argumento que vuelve al WebView. El destino es una
//! lista cerrada: los tres hosts oficiales, o HTTP sólo en la máquina local.
//!
//! Transporte: `ureq` + **rustls**. Los anclajes salen del almacén del sistema
//! (`rustls-native-certs`); si viene vacío, se cae a `webpki-roots`. Así una
//! VPN o antivirus que inserte su CA en Windows sigue siendo confiable.

#![forbid(unsafe_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::ServerName;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const BODY_CAP: usize = 12 * 1024 * 1024;
const TIMEOUT_SECS: u64 = 90;
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Respuesta ya limpia. `body` no contiene la clave.
#[derive(Debug, serde::Serialize)]
pub struct Exchange {
    pub status: u16,
    pub body: String,
}

/// Paso de la sonda «Probar conexión».
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeStep {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Informe ordenado DNS → TCP → TLS → HTTP → modelos.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub ok: bool,
    pub steps: Vec<ProbeStep>,
    pub models: Vec<String>,
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

/// Raíz de certificados: almacén del SO; si falla, webpki-roots.
fn root_store() -> rustls::RootCertStore {
    let mut store = rustls::RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    let mut added = 0usize;
    for cert in native.certs {
        if store.add(cert).is_ok() {
            added = added.saturating_add(1);
        }
    }
    if added == 0 {
        store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    }
    store
}

fn tls_config() -> Arc<rustls::ClientConfig> {
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store())
        .with_no_client_auth();
    Arc::new(config)
}

fn env_proxy() -> Option<ureq::Proxy> {
    for key in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(proxy) = ureq::Proxy::new(trimmed) {
                return Some(proxy);
            }
        }
    }
    None
}

fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .tls_config(tls_config());
    if let Some(proxy) = env_proxy() {
        builder = builder.proxy(proxy);
    }
    builder.build()
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
        || lower.contains("failed to lookup")
    {
        return "sin red: no se pudo resolver el host del proveedor (DNS)".to_string();
    }
    if lower.contains("connection refused") || lower.contains("actively refused") {
        return "sin red: conexión rechazada por el proveedor".to_string();
    }
    if lower.contains("connection reset") || lower.contains("broken pipe") {
        return "sin red: el proveedor cortó la conexión".to_string();
    }
    if lower.contains("certificate")
        || lower.contains("unknown issuer")
        || lower.contains("invalidpeer")
        || lower.contains("cert")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("handshake")
        || lower.contains("webpki")
    {
        return "certificado no confiable: el almacén de Windows no confía en la CA del servidor \
(posible VPN o antivirus interceptando HTTPS; importa esa CA en «Entidades de \
certificación raíz de confianza» — no hace falta apagar la VPN)"
            .to_string();
    }
    if lower.contains("unreachable") || lower.contains("network is unreachable") {
        return "sin red: no hay camino hasta el proveedor".to_string();
    }
    format!("sin respuesta del servidor ({text})")
}

/// Mensajes HTTP claros (sin filtrar la clave).
pub fn mensaje_http(status: u16, body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    match status {
        401 => Some(if lower.contains("key") || lower.contains("auth") || !body.is_empty() {
            format!(
                "clave inválida (HTTP 401){}",
                if body.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", body.chars().take(200).collect::<String>())
                }
            )
        } else {
            "clave inválida (HTTP 401): el proveedor rechazó la autenticación".to_string()
        }),
        402 => Some(
            "saldo insuficiente (HTTP 402): la cuenta del proveedor no tiene crédito".to_string(),
        ),
        404 => Some(if lower.contains("model") {
            "modelo o ruta no encontrados (HTTP 404)".to_string()
        } else {
            "ruta no encontrada (HTTP 404)".to_string()
        }),
        429 => Some("límite de peticiones (HTTP 429): espera un momento y reintenta".to_string()),
        _ => None,
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
        return Err("host no permitido: el destino no está en la lista del transporte".to_string());
    }
    if body.len() > BODY_CAP {
        return Err("la petición supera el tope".to_string());
    }
    let headers = cabeceras(provider, secret)?;
    let agent = agent();
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
        Err(error) => return Err(error_de_transporte(&error)),
    };
    Ok(Exchange {
        status,
        body: redactar(&text, secret.trim()),
    })
}

fn host_de_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.split(':').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn models_url(base: &str) -> String {
    let trimmed = base.trim().trim_end_matches('/');
    if trimmed.ends_with("/models") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/models")
    }
}

fn primer_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("DNS: {error}"))?
        .next()
        .ok_or_else(|| "DNS: sin direcciones".to_string())
}

/// Extrae CN=… del emisor si el DER del peer es legible a ojo (OID 2.5.4.3).
fn issuer_hint(der: &[u8]) -> Option<String> {
    // Busca el texto ASCII "CN=" cerca del principio del Subject/Issuer.
    let hay = String::from_utf8_lossy(der);
    for marker in ["CN=", "O="] {
        if let Some(idx) = hay.find(marker) {
            let slice = &hay[idx..];
            let end = slice
                .find(|c: char| c == ',' || c == '\0' || c < ' ')
                .unwrap_or_else(|| slice.len().min(80));
            let piece = slice[..end].trim();
            if piece.len() > 3 {
                return Some(piece.to_string());
            }
        }
    }
    None
}

fn handshake_tls(host: &str, addr: SocketAddr) -> Result<String, String> {
    let mut sock = TcpStream::connect_timeout(&addr, PROBE_TIMEOUT)
        .map_err(|error| format!("TCP previo a TLS: {error}"))?;
    let _ = sock.set_read_timeout(Some(PROBE_TIMEOUT));
    let _ = sock.set_write_timeout(Some(PROBE_TIMEOUT));
    let name = ServerName::try_from(host.to_string())
        .map_err(|_| format!("nombre SNI inválido: {host}"))?;
    let mut client = rustls::ClientConnection::new(tls_config(), name)
        .map_err(|error| format!("cliente TLS: {error}"))?;
    while client.is_handshaking() {
        client
            .complete_io(&mut sock)
            .map_err(|error| format!("handshake: {error}"))?;
    }
    let issuer = client
        .peer_certificates()
        .and_then(|certs| certs.first())
        .and_then(|cert| issuer_hint(cert.as_ref()))
        .unwrap_or_else(|| "emisor no etiquetado en DER".to_string());
    // Drena un poco para no dejar el socket a medias; el cierre basta.
    let _ = sock.read(&mut [0u8; 1]);
    let _ = sock.write(&[]);
    Ok(format!(
        "handshake rustls OK · almacén del sistema · peer≈{issuer}"
    ))
}

/// Sonda DNS → TCP → TLS → HTTP GET /models (con clave).
pub fn probe_connection(provider: &str, base_url: &str, secret: &str) -> ProbeReport {
    let mut steps = Vec::new();
    let mut models = Vec::new();
    let url = models_url(base_url);
    if !destino_permitido(&url) {
        steps.push(ProbeStep {
            name: "ACL".to_string(),
            ok: false,
            detail: format!("host no permitido para {url}"),
        });
        return ProbeReport {
            ok: false,
            steps,
            models,
        };
    }
    let Some(host) = host_de_url(&url) else {
        steps.push(ProbeStep {
            name: "URL".to_string(),
            ok: false,
            detail: "no se pudo extraer el host".to_string(),
        });
        return ProbeReport {
            ok: false,
            steps,
            models,
        };
    };

    let addr = match primer_addr(&host, 443) {
        Ok(addr) => {
            steps.push(ProbeStep {
                name: "DNS".to_string(),
                ok: true,
                detail: format!("resuelto → {addr}"),
            });
            addr
        }
        Err(detail) => {
            steps.push(ProbeStep {
                name: "DNS".to_string(),
                ok: false,
                detail,
            });
            return ProbeReport {
                ok: false,
                steps,
                models,
            };
        }
    };

    match TcpStream::connect_timeout(&addr, PROBE_TIMEOUT) {
        Ok(stream) => {
            drop(stream);
            steps.push(ProbeStep {
                name: "TCP".to_string(),
                ok: true,
                detail: format!("conectado a {addr}"),
            });
        }
        Err(error) => {
            steps.push(ProbeStep {
                name: "TCP".to_string(),
                ok: false,
                detail: format!("rechazado o inalcanzable: {error}"),
            });
            return ProbeReport {
                ok: false,
                steps,
                models,
            };
        }
    }

    match handshake_tls(&host, addr) {
        Ok(detail) => steps.push(ProbeStep {
            name: "TLS".to_string(),
            ok: true,
            detail,
        }),
        Err(detail) => {
            steps.push(ProbeStep {
                name: "TLS".to_string(),
                ok: false,
                detail: format!(
                    "{detail} · si hay VPN/antivirus, importa su CA al almacén de Windows \
(no hace falta apagar la VPN)"
                ),
            });
            return ProbeReport {
                ok: false,
                steps,
                models,
            };
        }
    }

    match exchange(provider, &url, "GET", "", secret) {
        Ok(result) => {
            if let Some(msg) = mensaje_http(result.status, &result.body) {
                steps.push(ProbeStep {
                    name: "HTTP".to_string(),
                    ok: false,
                    detail: msg,
                });
                return ProbeReport {
                    ok: false,
                    steps,
                    models,
                };
            }
            if !(200..300).contains(&result.status) {
                steps.push(ProbeStep {
                    name: "HTTP".to_string(),
                    ok: false,
                    detail: format!("HTTP {}", result.status),
                });
                return ProbeReport {
                    ok: false,
                    steps,
                    models,
                };
            }
            steps.push(ProbeStep {
                name: "HTTP".to_string(),
                ok: true,
                detail: format!("GET /models → {}", result.status),
            });
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&result.body) {
                if let Some(rows) = value.get("data").and_then(|d| d.as_array()) {
                    for row in rows {
                        if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                            models.push(id.to_string());
                        }
                    }
                }
            }
            models.sort();
            let preview = models.iter().take(8).cloned().collect::<Vec<_>>().join(", ");
            steps.push(ProbeStep {
                name: "modelos".to_string(),
                ok: !models.is_empty(),
                detail: if models.is_empty() {
                    "respuesta sin lista de modelos".to_string()
                } else {
                    format!("{} modelo(s): {preview}", models.len())
                },
            });
            let ok = steps.iter().all(|s| s.ok);
            ProbeReport { ok, steps, models }
        }
        Err(error) => {
            steps.push(ProbeStep {
                name: "HTTP".to_string(),
                ok: false,
                detail: error,
            });
            ProbeReport {
                ok: false,
                steps,
                models,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Shutdown, TcpListener};
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
    fn el_almacen_nativo_o_webpki_tiene_raices() {
        let store = root_store();
        assert!(
            !store.is_empty(),
            "debe haber anclajes nativos o webpki-roots"
        );
    }

    #[test]
    fn mensajes_http_distinguen_causas() {
        assert!(mensaje_http(401, "invalid api key")
            .unwrap_or_default()
            .contains("clave inválida"));
        assert!(mensaje_http(402, "")
            .unwrap_or_default()
            .contains("saldo"));
        assert!(mensaje_http(404, "model not found")
            .unwrap_or_default()
            .contains("404"));
        assert!(mensaje_http(429, "")
            .unwrap_or_default()
            .contains("límite"));
    }

    /// VPN encendida: `BARA_LIVE_TLS=1 cargo test -p bara-ide-desktop --lib deepseek_tls -- --ignored --nocapture`
    #[test]
    #[ignore = "red real; requiere VPN/red"]
    fn deepseek_tls_con_almacen_del_sistema() {
        let addr = primer_addr("api.deepseek.com", 443).expect("DNS");
        let detail = handshake_tls("api.deepseek.com", addr).expect("TLS");
        eprintln!("TLS DeepSeek: {detail}");
        assert!(detail.contains("handshake rustls OK"), "{detail}");
        // Sin clave válida: el transporte debe superar TLS y recibir HTTP 401.
        let err = exchange(
            "openai",
            "https://api.deepseek.com/models",
            "GET",
            "",
            "sk-live-probe-sin-credito",
        );
        match err {
            Ok(result) => {
                eprintln!("HTTP {}: {}", result.status, result.body.chars().take(120).collect::<String>());
                assert!(
                    result.status == 401 || (200..300).contains(&result.status),
                    "tras TLS se esperaba 401 o 2xx, no {}",
                    result.status
                );
            }
            Err(message) => {
                panic!("falló después del handshake local: {message}");
            }
        }
    }

    #[test]
    fn el_mock_local_responde_y_no_filtra_la_clave() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
        thread::spawn(move || {
            ready_tx.send(()).expect("listo");
            // Varios intentos: el cliente puede reintentar si la primera falla.
            for _ in 0..8 {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut raw = Vec::new();
                let mut buf = [0u8; 1024];
                let mut headers_done = false;
                loop {
                    match stream.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            raw.extend_from_slice(&buf[..n]);
                            if !headers_done && raw.windows(4).any(|w| w == b"\r\n\r\n") {
                                headers_done = true;
                                // Drena el cuerpo corto (`{}`) para no resetear al cliente.
                                let _ = stream.set_read_timeout(Some(Duration::from_millis(50)));
                                continue;
                            }
                            if headers_done || raw.len() > 8192 {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let body = r#"{"error":{"message":"clave-secreta-xyz inválida"}}"#;
                let response = format!(
                    "HTTP/1.0 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                if stream.write_all(response.as_bytes()).is_ok() {
                    let _ = stream.flush();
                    let _ = stream.shutdown(Shutdown::Write);
                    break;
                }
            }
        });
        ready_rx.recv().expect("servidor listo");
        let url = format!("http://127.0.0.1:{port}/v1/chat/completions");
        let result = exchange("openai", &url, "POST", "{}", "clave-secreta-xyz").expect("exchange");
        assert_eq!(result.status, 401);
        assert!(!result.body.contains("clave-secreta-xyz"));
        assert!(result.body.contains("••••"));
    }
}
