import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";
import { writeFileSync } from "fs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page =
  pages.find((p) => /AETHER|tauri|localhost:1420/i.test(p.title + p.url)) ||
  pages[0];
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
  return r.result?.result?.value ?? r.result?.value;
}

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
await send("Page.enable");

const st = await ev(`(async () => {
  const inv = window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  const archivos = [...document.querySelectorAll(".activity-btn")].find((b) =>
    /Archivos/i.test(b.textContent || ""),
  );
  if (archivos && archivos.getAttribute("aria-pressed") !== "true") archivos.click();
  const gen = [...document.querySelectorAll("button")].find((b) =>
    /genesis\\.bara/i.test(b.textContent || ""),
  );
  if (gen) gen.click();
  await new Promise((r) => setTimeout(r, 400));
  if (typeof inv === "function") {
    await inv("propose_editor_patch", {
      patch: ["# tip sticky", "ברא demo", "שמר panel"].join("\\n"),
    });
  }
  await new Promise((r) => setTimeout(r, 900));
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand-green")
    .trim();
  const accept = [...document.querySelectorAll("button")].filter((b) =>
    /^\\s*Aceptar\\s*$/i.test(b.textContent || ""),
  ).length;
  const reject = [...document.querySelectorAll("button")].filter((b) =>
    /^\\s*Rechazar\\s*$/i.test(b.textContent || ""),
  ).length;
  const kernel = (document.body.innerText || "").includes("kernel activo");
  const bannerBrowser = (document.body.innerText || "").includes(
    "esta pestaña no es el IDE",
  );
  return JSON.stringify({ bg, accept, reject, kernel, bannerBrowser });
})()`);
console.log("state", st);

async function shot(path) {
  const r = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(path, Buffer.from(r.result.data, "base64"));
  console.log("wrote", path);
}

await shot("docs/ui-shots/desktop-review-aceptar-rechazar.png");

const resized = await ev(`(async () => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const w = getCurrentWindow();
    await w.setSize(new LogicalSize(960, 600));
    await new Promise((r) => setTimeout(r, 500));
    return JSON.stringify(await w.outerSize());
  } catch (e) {
    return "err:" + String(e);
  }
})()`);
console.log("resize", resized);
await sleep(700);
await shot("docs/ui-shots/desktop-review-960x600.png");

const restored = await ev(`(async () => {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await getCurrentWindow().setSize(new LogicalSize(1280, 720));
    return "ok";
  } catch (e) {
    return String(e);
  }
})()`);
console.log("restore", restored);
await sleep(500);
await shot("docs/ui-shots/desktop-max-completa.png");
ws.close();
