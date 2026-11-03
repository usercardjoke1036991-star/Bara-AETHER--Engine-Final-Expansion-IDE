//! Llamadas a los proveedores de chat.
//!
//! La clave no viaja en el argumento que vuelve al WebView. El destino es una
//! lista cerrada: los tres hosts oficiales, o HTTP sólo en la máquina local.
//!
//! Transporte: HTTP/1.1 propio + **rustls** (sin seguir redirects). Los anclajes
//! salen del almacén del sistema (`rustls-native-certs`); si viene vacío, se
//! cae a `webpki-roots`. Así una VPN o antivirus que inserte su CA en Windows
//! sigue siendo confiable. Detener cierra el socket del vuelo.

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
///
/// §9.5.12 `local` (Ollama/HTTP): sin Authorization ni x-api-key.
fn cabeceras(provider: &str, secret: &str) -> Result<Vec<(&'static str, String)>, String> {
    match provider.trim() {
        "local" => Ok(Vec::new()),
        other => {
            let secret = secret.trim();
            if secret.is_empty() {
                return Err("no hay clave para este proveedor".to_string());
            }
            match other {
                "anthropic" => Ok(vec![
                    ("x-api-key", secret.to_string()),
                    ("anthropic-version", ANTHROPIC_VERSION.to_string()),
                ]),
                // OpenAI y DeepSeek usan Bearer.
                "openai" | "deepseek" => Ok(vec![("authorization", format!("Bearer {secret}"))]),
                _ => Err("el proveedor no tiene transporte".to_string()),
            }
        }
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

/// ¿Este destino puede salir por el proxy de entorno?
/// Loopback nunca: la clave y el tráfico local no pasan por `HTTPS_PROXY`.
pub fn destino_usa_proxy(url: &str) -> bool {
    destino_permitido(url) && !es_http_local(url)
}

fn proxy_http_de_entorno() -> Option<(String, u16)> {
    for key in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        let Ok(value) = std::env::var(key) else {
            continue;
        };
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(rest) = trimmed
            .strip_prefix("http://")
            .or_else(|| trimmed.strip_prefix("https://"))
        else {
            continue;
        };
        if rest.contains('@') {
            continue;
        }
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        if authority.is_empty() {
            continue;
        }
        if let Some((host, port)) = authority.rsplit_once(':') {
            if let Ok(port) = port.parse::<u16>() {
                if !host.is_empty() {
                    return Some((host.to_string(), port));
                }
            }
        } else {
            return Some((authority.to_string(), 8080));
        }
    }
    None
}

/// Política de la clave frente al host de la URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoliticaClave {
    /// `local` o loopback del proveedor local: no hay secreto.
    SinSecreto,
    /// Nube: la clave sólo sale si el host es el oficial de ese proveedor.
    Exigir,
}

pub fn politica_clave(provider: &str, url: &str) -> Result<PoliticaClave, String> {
    if !destino_permitido(url) {
        return Err("host no permitido: el destino no está en la lista del transporte".to_string());
    }
    let provider = provider.trim();
    let loopback = es_http_local(url);
    if provider == "local" {
        return Ok(PoliticaClave::SinSecreto);
    }
    if loopback {
        return Err("la clave de la nube no se envía a localhost".to_string());
    }
    let host = host_de_url(url).unwrap_or_default();
    let oficial = match provider {
        "anthropic" => "api.anthropic.com",
        "openai" => "api.openai.com",
        "deepseek" => "api.deepseek.com",
        _ => return Err("el proveedor no tiene transporte".to_string()),
    };
    if host != oficial {
        return Err("la clave sólo viaja al host oficial de este proveedor".to_string());
    }
    Ok(PoliticaClave::Exigir)
}

/// Traduce fallos de transporte a mensajes claros en español.
fn error_de_transporte(error: &std::io::Error) -> String {
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
        return "no hay servidor en localhost (¿Ollama u otro HTTP local en marcha?)".to_string();
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
        401 => Some(
            if lower.contains("key") || lower.contains("auth") || !body.is_empty() {
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
            },
        ),
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
///
/// No se sigue `Location` (redirects cerrados). `flight` cierra el socket si Detener.
pub fn exchange(
    provider: &str,
    url: &str,
    method: &str,
    body: &str,
    secret: &str,
) -> Result<Exchange, String> {
    exchange_with(provider, url, method, body, secret, None)
}

pub fn exchange_with(
    provider: &str,
    url: &str,
    method: &str,
    body: &str,
    secret: &str,
    flight: Option<&crate::ai_flight::FlightHandle>,
) -> Result<Exchange, String> {
    let method = method.trim().to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Err("el método no está en el catálogo".to_string());
    }
    if body.len() > BODY_CAP {
        return Err("la petición supera el tope".to_string());
    }
    let politica = politica_clave(provider, url)?;
    let secret = match politica {
        PoliticaClave::SinSecreto => String::new(),
        PoliticaClave::Exigir => {
            let secret = secret.trim();
            if secret.is_empty() {
                return Err("no hay clave para este proveedor".to_string());
            }
            secret.to_string()
        }
    };
    let header_provider = if secret.is_empty() { "local" } else { provider };
    let headers = cabeceras(header_provider, &secret)?;
    if flight.is_some_and(|item| item.is_cancelled()) {
        return Err("cancelado".to_string());
    }
    let (status, text) = http_exchange(url, &method, body, &headers, flight)?;
    if (300..400).contains(&status) {
        return Err("redirect bloqueado: no se sigue Location".to_string());
    }
    Ok(Exchange {
        status,
        body: redactar(&text, &secret),
    })
}

fn http_exchange(
    url: &str,
    method: &str,
    body: &str,
    headers: &[(&str, String)],
    flight: Option<&crate::ai_flight::FlightHandle>,
) -> Result<(u16, String), String> {
    let host = host_de_url(url).ok_or_else(|| "no se pudo extraer el host".to_string())?;
    let https = url.starts_with("https://");
    let port = puerto_de_url(url, 443, 80);
    let mut sock = conectar(&host, port, url, flight)?;
    let path = ruta_de_url(url);
    let host_header = if (https && port == 443) || (!https && port == 80) {
        host.clone()
    } else {
        format!("{host}:{port}")
    };
    let mut req =
        format!("{method} {path} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n");
    for (name, value) in headers {
        req.push_str(name);
        req.push_str(": ");
        req.push_str(value);
        req.push_str("\r\n");
    }
    if method == "POST" {
        req.push_str("content-type: application/json\r\n");
        req.push_str(&format!("content-length: {}\r\n", body.len()));
    }
    req.push_str("\r\n");
    if method == "POST" {
        req.push_str(body);
    }
    let raw = if https {
        let name = ServerName::try_from(host.clone())
            .map_err(|_| format!("nombre SNI inválido: {host}"))?;
        let mut conn = rustls::ClientConnection::new(tls_config(), name)
            .map_err(|error| format!("cliente TLS: {error}"))?;
        escribir(&mut sock, Some(&mut conn), req.as_bytes(), flight)?;
        leer(&mut sock, Some(&mut conn), flight)?
    } else {
        escribir(&mut sock, None, req.as_bytes(), flight)?;
        leer(&mut sock, None, flight)?
    };
    partir_respuesta(&raw)
}

fn conectar(
    host: &str,
    port: u16,
    url: &str,
    flight: Option<&crate::ai_flight::FlightHandle>,
) -> Result<TcpStream, String> {
    if flight.is_some_and(|item| item.is_cancelled()) {
        return Err("cancelado".to_string());
    }
    let (dial_host, dial_port, via_proxy) = if destino_usa_proxy(url) {
        if let Some((proxy_host, proxy_port)) = proxy_http_de_entorno() {
            (proxy_host, proxy_port, true)
        } else {
            (host.to_string(), port, false)
        }
    } else {
        (host.to_string(), port, false)
    };
    let addr = primer_addr(&dial_host, dial_port)?;
    let mut sock = TcpStream::connect_timeout(&addr, Duration::from_secs(15)).map_err(|error| {
        if flight.is_some_and(|item| item.is_cancelled()) {
            "cancelado".to_string()
        } else {
            error_de_transporte(&error)
        }
    })?;
    if let Some(flight) = flight {
        flight.track_socket(&sock);
    }
    let _ = sock.set_nodelay(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = sock.set_write_timeout(Some(Duration::from_secs(30)));
    if via_proxy {
        let connect = format!(
            "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\nProxy-Connection: keep-alive\r\n\r\n"
        );
        sock.write_all(connect.as_bytes())
            .map_err(|error| error_de_transporte(&error))?;
        let raw = read_until_http(&mut sock, flight, true)?;
        let (status, _) = partir_respuesta(&raw)?;
        if status != 200 {
            return Err(format!("el proxy rechazó CONNECT (HTTP {status})"));
        }
    }
    Ok(sock)
}

fn escribir(
    sock: &mut TcpStream,
    tls: Option<&mut rustls::ClientConnection>,
    bytes: &[u8],
    flight: Option<&crate::ai_flight::FlightHandle>,
) -> Result<(), String> {
    let resultado = if let Some(conn) = tls {
        let mut stream = rustls::Stream::new(conn, sock);
        stream.write_all(bytes).and_then(|()| stream.flush())
    } else {
        sock.write_all(bytes).and_then(|()| sock.flush())
    };
    resultado.map_err(|error| {
        if flight.is_some_and(|item| item.is_cancelled()) {
            "cancelado".to_string()
        } else {
            error_de_transporte(&error)
        }
    })
}

fn leer(
    sock: &mut TcpStream,
    tls: Option<&mut rustls::ClientConnection>,
    flight: Option<&crate::ai_flight::FlightHandle>,
) -> Result<Vec<u8>, String> {
    if let Some(conn) = tls {
        let mut stream = rustls::Stream::new(conn, sock);
        read_until_http(&mut stream, flight, false)
    } else {
        read_until_http(sock, flight, false)
    }
}

fn read_until_http(
    read: &mut dyn Read,
    flight: Option<&crate::ai_flight::FlightHandle>,
    only_headers: bool,
) -> Result<Vec<u8>, String> {
    let start = std::time::Instant::now();
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        if flight.is_some_and(|item| item.is_cancelled()) {
            return Err("cancelado".to_string());
        }
        if start.elapsed() > Duration::from_secs(TIMEOUT_SECS) {
            return Err("tiempo de espera agotado al hablar con el proveedor".to_string());
        }
        match read.read(&mut buf) {
            Ok(0) => {
                if flight.is_some_and(|item| item.is_cancelled()) {
                    return Err("cancelado".to_string());
                }
                break;
            }
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > BODY_CAP.saturating_add(65_536) {
                    return Err("la respuesta supera el tope".to_string());
                }
                if only_headers && raw.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if !only_headers && respuesta_completa(&raw) {
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::TimedOut
                    || error.kind() == std::io::ErrorKind::WouldBlock =>
            {
                continue;
            }
            Err(error) => {
                if flight.is_some_and(|item| item.is_cancelled()) {
                    return Err("cancelado".to_string());
                }
                if !raw.is_empty() && respuesta_completa(&raw) {
                    break;
                }
                return Err(error_de_transporte(&error));
            }
        }
    }
    if flight.is_some_and(|item| item.is_cancelled()) {
        return Err("cancelado".to_string());
    }
    if raw.is_empty() {
        return Err("sin respuesta del servidor".to_string());
    }
    Ok(raw)
}

fn respuesta_completa(raw: &[u8]) -> bool {
    let Some(idx) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return false;
    };
    let head = String::from_utf8_lossy(&raw[..idx]);
    let body = &raw[idx + 4..];
    if let Some(n) = content_length(&head) {
        return body.len() >= n;
    }
    if es_chunked(&head) {
        return chunked_completo(body);
    }
    false
}

fn content_length(head: &str) -> Option<usize> {
    for line in head.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            return value.trim().parse::<usize>().ok();
        }
    }
    None
}

fn es_chunked(head: &str) -> bool {
    let lower = head.to_ascii_lowercase();
    lower.contains("transfer-encoding:") && lower.contains("chunked")
}

fn chunked_completo(body: &[u8]) -> bool {
    body.windows(5).any(|w| w == b"0\r\n\r\n")
}

fn partir_respuesta(raw: &[u8]) -> Result<(u16, String), String> {
    let idx = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "respuesta HTTP incompleta".to_string())?;
    let head =
        std::str::from_utf8(&raw[..idx]).map_err(|_| "cabeceras HTTP no utf-8".to_string())?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "status HTTP ilegible".to_string())?;
    let body_bytes = &raw[idx + 4..];
    let body = if es_chunked(head) {
        decode_chunked(body_bytes)?
    } else if let Some(n) = content_length(head) {
        let n = n.min(body_bytes.len());
        String::from_utf8_lossy(&body_bytes[..n]).into_owned()
    } else {
        String::from_utf8_lossy(body_bytes).into_owned()
    };
    Ok((status, body))
}

fn decode_chunked(body: &[u8]) -> Result<String, String> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(line_end) = rest.windows(2).position(|w| w == b"\r\n") {
        let line = std::str::from_utf8(&rest[..line_end]).unwrap_or("");
        let size = usize::from_str_radix(line.trim().split(';').next().unwrap_or("0"), 16)
            .map_err(|_| "chunk HTTP ilegible".to_string())?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            break;
        }
        if rest.len() < size {
            return Err("chunk HTTP incompleto".to_string());
        }
        out.extend_from_slice(&rest[..size]);
        rest = &rest[size..];
        if rest.starts_with(b"\r\n") {
            rest = &rest[2..];
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

fn ruta_de_url(url: &str) -> String {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    match rest.find('/') {
        Some(index) => rest[index..].to_string(),
        None => "/".to_string(),
    }
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

fn es_http_local(url: &str) -> bool {
    url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1")
}

fn puerto_de_url(url: &str, default_https: u16, default_http: u16) -> u16 {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if let Some((_, port)) = authority.rsplit_once(':') {
        if let Ok(n) = port.parse::<u16>() {
            return n;
        }
    }
    if url.starts_with("http://") {
        default_http
    } else {
        default_https
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

/// Sonda DNS → TCP → (TLS si https) → HTTP GET /models.
/// §9.5.12: HTTP local omite TLS y no exige clave.
pub fn probe_connection(provider: &str, base_url: &str, secret: &str) -> ProbeReport {
    let mut steps = Vec::new();
    let mut models = Vec::new();
    // Ollama OpenAI-compatible: raíz sin /v1 → …/v1/models.
    let probe_base = if es_http_local(base_url) {
        let trimmed = base_url.trim().trim_end_matches('/');
        if trimmed.ends_with("/v1") || trimmed.contains("/v1/") {
            trimmed.to_string()
        } else {
            format!("{trimmed}/v1")
        }
    } else {
        base_url.trim().to_string()
    };
    let url = models_url(&probe_base);
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

    let local_http = es_http_local(&url);
    let port = puerto_de_url(&url, 443, 80);
    let addr = match primer_addr(&host, port) {
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
            let detail = if local_http {
                format!("no hay servidor en {host}:{port} (¿Ollama u otro HTTP local?): {error}")
            } else {
                format!("rechazado o inalcanzable: {error}")
            };
            steps.push(ProbeStep {
                name: "TCP".to_string(),
                ok: false,
                detail,
            });
            return ProbeReport {
                ok: false,
                steps,
                models,
            };
        }
    }

    if !local_http {
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
    } else {
        steps.push(ProbeStep {
            name: "TLS".to_string(),
            ok: true,
            detail: "omitido (HTTP local)".to_string(),
        });
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
            let preview = models
                .iter()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
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
        let local_headers = cabeceras("local", "").expect("local sin clave");
        assert!(local_headers.is_empty(), "local no envía Authorization");
        assert!(cabeceras("local", "ignorada").expect("local").is_empty());
        let blocked = exchange("anthropic", "https://api.example/v1", "POST", "{}", "x");
        assert!(blocked
            .expect_err("host ajeno")
            .contains("host no permitido"));
    }

    #[test]
    fn el_mock_local_sin_auth_no_lleva_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<String>();
        thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut raw = Vec::new();
            let mut buf = [0u8; 1024];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        raw.extend_from_slice(&buf[..n]);
                        if raw.windows(4).any(|w| w == b"\r\n\r\n") || raw.len() > 8192 {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let request = String::from_utf8_lossy(&raw).to_string();
            let _ = ready_tx.send(request);
            let body = r#"{"object":"list","data":[{"id":"llama3.2"}]}"#;
            let response = format!(
                "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            let _ = stream.shutdown(Shutdown::Write);
        });
        let url = format!("http://127.0.0.1:{port}/v1/models");
        let result = exchange("local", &url, "GET", "", "").expect("exchange local");
        assert_eq!(result.status, 200);
        let seen = ready_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("headers");
        assert!(
            !seen.to_ascii_lowercase().contains("authorization"),
            "no debe viajar Bearer: {seen}"
        );
        assert!(
            !seen.to_ascii_lowercase().contains("x-api-key"),
            "no debe viajar x-api-key: {seen}"
        );
        assert!(result.body.contains("llama3.2"));
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
        assert!(mensaje_http(402, "").unwrap_or_default().contains("saldo"));
        assert!(mensaje_http(404, "model not found")
            .unwrap_or_default()
            .contains("404"));
        assert!(mensaje_http(429, "").unwrap_or_default().contains("límite"));
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
            "deepseek",
            "https://api.deepseek.com/models",
            "GET",
            "",
            "sk-live-probe-sin-credito",
        );
        match err {
            Ok(result) => {
                eprintln!(
                    "HTTP {}: {}",
                    result.status,
                    result.body.chars().take(120).collect::<String>()
                );
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
        let err = exchange("openai", &url, "POST", "{}", "clave-secreta-xyz")
            .expect_err("nube + localhost");
        assert!(
            err.contains("localhost"),
            "debe bloquear la clave de la nube: {err}"
        );
        assert!(
            !err.contains("clave-secreta-xyz"),
            "el error no filtra la clave: {err}"
        );
    }

    #[test]
    fn politica_nube_solo_en_su_host_y_local_sin_secreto() {
        assert!(matches!(
            politica_clave("local", "http://127.0.0.1:11434/v1/chat/completions"),
            Ok(PoliticaClave::SinSecreto)
        ));
        assert!(matches!(
            politica_clave("openai", "https://api.openai.com/v1/chat/completions"),
            Ok(PoliticaClave::Exigir)
        ));
        assert!(politica_clave("openai", "http://127.0.0.1:11434/v1").is_err());
        assert!(politica_clave("openai", "https://api.deepseek.com/v1").is_err());
        assert!(!destino_usa_proxy("http://127.0.0.1:11434/v1"));
        assert!(!destino_usa_proxy("http://localhost/v1"));
        assert!(destino_usa_proxy("https://api.openai.com/v1"));
    }

    #[test]
    fn redirect_local_no_se_sigue() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let body = "no-seguir";
            let response = format!(
                "HTTP/1.0 302 Found\r\nLocation: https://evil.example/robo\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        let url = format!("http://127.0.0.1:{port}/v1/chat");
        let err = exchange("local", &url, "GET", "", "").expect_err("redirect");
        assert!(err.contains("redirect bloqueado"), "{err}");
        assert!(!err.contains("evil.example") || err.contains("bloqueado"));
    }

    #[test]
    fn detener_cierra_el_socket_en_vuelo() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = [0u8; 512];
            let _ = stream.read(&mut buf);
            thread::sleep(Duration::from_secs(30));
        });
        let flight = crate::ai_flight::AiFlight::new();
        let handle = flight.handle();
        handle.begin();
        let cancel = handle.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            cancel.request_cancel();
        });
        let url = format!("http://127.0.0.1:{port}/v1/chat");
        let started = std::time::Instant::now();
        let err = exchange_with("local", &url, "GET", "", "", Some(&handle)).expect_err("cancel");
        assert!(err.contains("cancelado"), "{err}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "el corte debe ser pronto, no el timeout de 90s"
        );
    }
}
