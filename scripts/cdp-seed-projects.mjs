import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page = pages.find((p) => /AETHER|tauri/i.test(p.title + p.url)) || pages[0];
const ws = new WebSocket(assertLocalCdpWs(page.webSocketDebuggerUrl));
let id = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    const onmsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === mid) {
        ws.off("message", onmsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg);
      }
    };
    ws.on("message", onmsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evalExpr(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.value;
}

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});

await evalExpr(`(() => {
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  const archivos = [...document.querySelectorAll(".activity-btn")].find((b) =>
    /Archivos/i.test(b.textContent || ""),
  );
  if (archivos) archivos.click();
  return "prep";
})()`);

await new Promise((r) => setTimeout(r, 600));

const seeded = await evalExpr(`(async () => {
  const inv = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (typeof inv !== "function") return "no-invoke";
  const shelf1 = await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\bara-ide" });
  const shelf2 = await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\BAR" });
  // seed chat histories in localStorage
  const key = (p) => p.replace(/\\\\/g, "/").trim().toLowerCase();
  const storeKey = "bara.chat.byProject.v1";
  const bucket = {};
  const mk = (text) => ({
    id: crypto.randomUUID(),
    role: "assistant",
    text,
    model: "seed",
    createdAt: Date.now(),
    error: null,
    images: [],
  });
  bucket[key("C:/Users/Vexor/Downloads/bara-ide")] = [mk("Hilo del proyecto bara-ide (IDE).")];
  bucket[key("C:/Users/Vexor/Downloads/BAR")] = [mk("Hilo del proyecto BAR (kernel).")];
  localStorage.setItem(storeKey, JSON.stringify(bucket));
  // activate BAR so UI shows its tree+chat after reload of messages via project switch
  return JSON.stringify({
    roots: shelf2.roots.map((r) => r.name + (r.active ? "*" : "")),
    active: shelf2.activeId,
  });
})()`);

console.log("SEED", seeded);
ws.close();
