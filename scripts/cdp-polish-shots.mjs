import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";
import { writeFileSync } from "fs";

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
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

// Dismiss welcome + force Archivos side mode + open genesis if listed
await evalExpr(`(() => {
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  const archivos = [...document.querySelectorAll(".activity-btn")].find((b) =>
    /Archivos/i.test(b.textContent || ""),
  );
  if (archivos && archivos.getAttribute("aria-pressed") !== "true") archivos.click();
  const gen = [...document.querySelectorAll("button")].find((b) =>
    /genesis\\.bara/i.test(b.textContent || "") || /◈genesis/i.test(b.textContent || ""),
  );
  if (gen) gen.click();
  return "prep";
})()`);
await sleep(800);

// Clear prior banners
await evalExpr(`(() => {
  const ok = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "ok");
  if (ok) ok.click();
  return "cleared";
})()`);
await sleep(400);

const proposed = await evalExpr(`(async () => {
  const inv = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (typeof inv !== "function") return "no-invoke";
  const patch = ["# polish sticky", "ברא demo", "שמר panel"].join("\\n");
  await inv("propose_editor_patch", { patch });
  return "proposed";
})()`);
await sleep(1200);

const before = await evalExpr(`JSON.stringify({
  accept: [...document.querySelectorAll("button")].some((b) => /Aceptar/.test(b.textContent || "")),
  reject: [...document.querySelectorAll("button")].some((b) => /Rechazar/.test(b.textContent || "")),
  archivos: [...document.querySelectorAll(".activity-btn")].some((b) =>
    /Archivos/i.test(b.textContent || "") && b.getAttribute("aria-pressed") === "true"),
  banner: (document.querySelector(".patch-banner")?.innerText || "").slice(0, 180),
  dock: !!document.querySelector(".ai-review-dock"),
})`);
console.log("BEFORE", before);

writeFileSync("scripts/.polish-before.json", before || "{}");
ws.close();
