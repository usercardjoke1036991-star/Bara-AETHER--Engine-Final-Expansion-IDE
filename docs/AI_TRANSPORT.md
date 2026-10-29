# Transporte de IA

Todas las llamadas a proveedores de chat salen del proceso Rust vía los
comandos Tauri `ai_exchange` y `ai_probe_connection`
(`src-tauri/src/ai_http.rs`). El WebView:

- construye URL y cuerpo JSON en TypeScript (`web/src/ai/providers.ts`);
- **no** adjunta la API key (queda en el llavero / sesión del host);
- invoca `exchange()` → `invoke("ai_exchange", …)` (`web/src/ai/keyring.ts`);
- puede lanzar «Probar conexión» → `probeConnection()` →
  `ai_probe_connection` (DNS → TCP → TLS → HTTP GET `/models`).

No hay `fetch` / `XMLHttpRequest` / `axios` hacia OpenAI, Anthropic ni DeepSeek
desde el frontend.

## TLS

- Cliente: **ureq** + **rustls** (feature `tls`, sin `native-tls`/OpenSSL).
- Anclajes: `rustls-native-certs` (almacén del SO). Si el almacén viene vacío,
  reserva `webpki-roots`.
- Con Proton VPN u otro intermediario que inserte su CA en Windows, rustls
  confía en esa CA **sin apagar la VPN**. Si el handshake falla, el mensaje
  pide importar la CA en «Entidades de certificación raíz de confianza».
- Proxy opcional: `HTTPS_PROXY` / `ALL_PROXY`.

## Consola del sidecar

`bara-kernel-host` se arranca con `CREATE_NO_WINDOW` y
`#![windows_subsystem = "windows"]` para no abrir una consola negra junto al
IDE. stdin/stdout/stderr siguen en pipes hacia el supervisor.
