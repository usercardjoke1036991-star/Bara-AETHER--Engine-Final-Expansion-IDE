/**
 * Conexión CDP acotada a localhost:9229.
 * Valida el `webSocketDebuggerUrl` antes de abrir el socket (mitiga SSRF).
 */

import WebSocket from "ws";

export const CDP_HTTP = "http://127.0.0.1:9229";
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_PORT = "9229";

/** Rechaza cualquier WS que no sea el depurador local del WebView. */
export function assertLocalCdpWs(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ""));
  } catch {
    throw new Error("CDP: URL WebSocket inválida");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("CDP: el depurador debe ser ws(s)");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`CDP: host no permitido (${parsed.hostname})`);
  }
  const port = parsed.port || (parsed.protocol === "wss:" ? "443" : "80");
  if (port !== ALLOWED_PORT) {
    throw new Error(`CDP: puerto no permitido (${port})`);
  }
  return parsed.toString();
}

/** Página DevTools del IDE (título AETHER/tauri) o la primera listada. */
export async function pickCdpPage() {
  const pages = await (await fetch(`${CDP_HTTP}/json`)).json();
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("CDP: no hay páginas en 127.0.0.1:9229");
  }
  const page =
    pages.find((p) => /AETHER|tauri|localhost:1420/i.test(`${p.title ?? ""}${p.url ?? ""}`)) ||
    pages[0];
  const wsUrl = assertLocalCdpWs(page.webSocketDebuggerUrl);
  return { page, wsUrl };
}

/** Abre el WebSocket CDP ya validado. */
export async function openCdpSocket() {
  const { page, wsUrl } = await pickCdpPage();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, page, wsUrl };
}
