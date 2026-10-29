# Transporte de IA (Parte B · B4)

Todas las llamadas a proveedores de chat salen del proceso Rust vía el comando
Tauri `ai_exchange` (`src-tauri/src/ai_http.rs`). El WebView:

- construye URL y cuerpo JSON en TypeScript (`web/src/ai/providers.ts`);
- **no** adjunta la API key (queda en el llavero / sesión del host);
- invoca `exchange()` → `invoke("ai_exchange", …)` (`web/src/ai/keyring.ts`).

No hay `fetch` / `XMLHttpRequest` / `axios` hacia OpenAI, Anthropic ni DeepSeek
desde el frontend. El autodiagnóstico `test:ai` lo comprueba (cabecera
`Authorization` ausente + puente `exchange`).
