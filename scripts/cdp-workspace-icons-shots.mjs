import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";
import { writeFileSync } from "fs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page =
  pages.find((p) => /AETHER|tauri/i.test(p.title + p.url)) || pages[0];
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text ||
        "eval failed",
    );
  }
  return r.result?.value ?? r.result?.result?.value;
}
async function shot(path) {
  const r = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(path, Buffer.from(r.result.data, "base64"));
  console.log("wrote", path);
}

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
await send("Page.enable");

// Ensure Archivos + dismiss welcome
await ev(`(() => {
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  const archivos = [...document.querySelectorAll(".activity-btn")].find((b) =>
    /Archivos/i.test(b.textContent || ""),
  );
  if (archivos && archivos.getAttribute("aria-pressed") !== "true") archivos.click();
  return true;
})()`);
await sleep(400);

// Expand samples if present
await ev(`(() => {
  const samples = [...document.querySelectorAll(".tree-row.tree-dir")].find((b) =>
    /samples/i.test(b.textContent || ""),
  );
  if (samples) samples.click();
  return !!samples;
})()`);
await sleep(300);

await shot("docs/ui-shots/desktop-proyectos-archivos-bar.png");

// Switch to IDE project
const switched = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const s = await inv("workspace_roots");
  const ide = s.roots.find((r) => /bara-ide/i.test(r.name));
  if (ide) await inv("workspace_activate", { id: ide.id });
  await new Promise((r) => setTimeout(r, 700));
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  return {
    meta: document.querySelector(".workspace-root")?.textContent,
    chat: (document.querySelector(".ai-log")?.innerText || "").slice(0, 120),
    icons: document.querySelectorAll(".ws-icon").length,
  };
})()`);
console.log("switch", switched);
await sleep(400);
await shot("docs/ui-shots/desktop-proyectos-switch-ide.png");

// Open genesis + propose sticky
const sticky = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const clickOk = () => {
    for (const b of [...document.querySelectorAll("button")]) {
      if (/^ok$/i.test(b.textContent.trim())) b.click();
    }
  };
  await inv("propose_editor_patch", {
    patch: ["# sticky icons", "ברא demo", "שמר panel"].join("\\n"),
  });
  await new Promise((r) => setTimeout(r, 500));
  clickOk();
  await new Promise((r) => setTimeout(r, 800));
  const gen = [...document.querySelectorAll("button")].find((b) =>
    /genesis\\.bara/i.test(b.textContent || ""),
  );
  if (gen) gen.click();
  await new Promise((r) => setTimeout(r, 600));
  clickOk();
  await new Promise((r) => setTimeout(r, 400));
  await inv("propose_editor_patch", {
    patch: ["# sticky icons", "ברא demo", "שמר panel"].join("\\n"),
  });
  await new Promise((r) => setTimeout(r, 900));
  return {
    accept: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Aceptar",
    ),
    reject: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Rechazar",
    ),
    dock: !!document.querySelector(".ai-review-dock"),
    brand: getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-green")
      .trim(),
  };
})()`);
console.log("sticky", sticky);
await shot("docs/ui-shots/desktop-review-aceptar-rechazar.png");
await shot("docs/ui-shots/desktop-max-completa.png");

ws.close();
