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

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
await send("Page.enable");

const prep = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const clickOk = () => {
    for (const b of [...document.querySelectorAll("button")]) {
      if (/^ok$/i.test(b.textContent.trim())) b.click();
    }
  };
  clickOk();
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  await new Promise((r) => setTimeout(r, 300));
  const panels = JSON.parse(localStorage.getItem("bara.panels.v2") || "{}");
  panels.sideMode = "files";
  panels.chatOpen = true;
  localStorage.setItem("bara.panels.v2", JSON.stringify(panels));
  await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\bara-ide" });
  await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\BAR" });
  const s = await inv("workspace_roots");
  const ide = s.roots.find((r) => /bara-ide/i.test(r.name));
  await inv("workspace_activate", { id: ide.id });
  await new Promise((r) => setTimeout(r, 800));

  // Force open genesis via propose dialog path: first propose triggers offer, click ok
  await inv("propose_editor_patch", {
    patch: ["# sticky tip", "ברא demo", "שמר panel"].join("\\n"),
  });
  await new Promise((r) => setTimeout(r, 500));
  clickOk();
  await new Promise((r) => setTimeout(r, 900));
  // if still no editor, click genesis in tree
  const gen = [...document.querySelectorAll("button")].find((b) =>
    /genesis\\.bara/i.test(b.textContent || ""),
  );
  if (gen) gen.click();
  await new Promise((r) => setTimeout(r, 700));
  clickOk();
  await new Promise((r) => setTimeout(r, 500));
  await inv("propose_editor_patch", {
    patch: ["# sticky tip", "ברא demo", "שמר panel"].join("\\n"),
  });
  await new Promise((r) => setTimeout(r, 1000));
  clickOk();
  await new Promise((r) => setTimeout(r, 800));
  return {
    roots: s.roots.map((r) => r.name),
    tabs: [...document.querySelectorAll(".tab")].map((t) =>
      t.textContent.trim().slice(0, 50),
    ),
    accept: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Aceptar",
    ),
    reject: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Rechazar",
    ),
    dock: !!document.querySelector(".ai-review-dock"),
    banner: (document.querySelector(".patch-banner")?.innerText || "").slice(0, 160),
    brand: getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-green")
      .trim(),
    kernel: /kernel activo/i.test(document.body.innerText),
    browserBanner: /esta pestaña no es el IDE/i.test(document.body.innerText),
  };
})()`);
console.log("prep", JSON.stringify(prep, null, 2));

async function shot(path) {
  const r = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(path, Buffer.from(r.result.data, "base64"));
  console.log("wrote", path);
}

if (prep.accept && prep.reject) {
  await shot("docs/ui-shots/desktop-review-aceptar-rechazar.png");
} else {
  console.log("WARN: sticky not ready, capturing anyway");
  await shot("docs/ui-shots/desktop-review-aceptar-rechazar.png");
}

ws.close();
