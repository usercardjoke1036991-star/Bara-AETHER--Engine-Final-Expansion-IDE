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
await send("Page.reload", { ignoreCache: true });
await sleep(2500);

const boot = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  const cont = [...document.querySelectorAll("button")].find((b) =>
    /Continuar con la carpeta/i.test(b.textContent || ""),
  );
  if (cont) cont.click();
  const archivos = [...document.querySelectorAll(".activity-btn")].find((b) =>
    /Archivos/i.test(b.textContent || ""),
  );
  if (archivos && archivos.getAttribute("aria-pressed") !== "true") archivos.click();
  if (typeof inv === "function") {
    await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\bara-ide" });
    await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\BAR" });
  }
  await new Promise((r) => setTimeout(r, 800));
  const paths = [...document.querySelectorAll(".shelf-path")].map((e) => e.textContent.trim());
  const names = [...document.querySelectorAll(".shelf-name")].map((e) => e.textContent.trim());
  const heads = [...document.querySelectorAll("h1,h2,.side-head strong")].map((e) =>
    e.textContent.trim(),
  );
  const verbatim = (document.body.innerText || "").includes("\\\\?");
  const brand = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand-green")
    .trim();
  return { names, paths, heads, verbatim, brand, icons: document.querySelectorAll(".ws-icon").length };
})()`);
console.log("workspace", boot);
await shot("docs/ui-shots/desktop-proyectos-archivos-bar.png");

// Open settings / DeepSeek UI
const settings = await ev(`(async () => {
  const chat = [...document.querySelectorAll("button,.activity-btn")].find((b) =>
    /Chat|Asistencia/i.test(b.textContent || ""),
  );
  if (chat) chat.click();
  await new Promise((r) => setTimeout(r, 400));
  const ajustes = [...document.querySelectorAll("button")].find((b) =>
    /^\\s*ajustes\\s*$/i.test(b.textContent || ""),
  );
  if (ajustes) ajustes.click();
  await new Promise((r) => setTimeout(r, 500));
  const select = document.querySelector(".ai-settings select");
  if (select) {
    select.value = "deepseek";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 300));
  const root = document.querySelector('.ai-settings input[aria-label="Raíz de la API"]');
  if (root) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(root, "https://api.deepseek.com");
    root.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const deepBtn = [...document.querySelectorAll(".ai-settings button")].find((b) =>
    /^\\s*DeepSeek\\s*$/i.test(b.textContent || ""),
  );
  if (deepBtn) deepBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  return {
    provider: select?.value || null,
    root: root?.value || null,
    editable: root ? root.readOnly === false : null,
    hasDeepBtn: !!deepBtn,
    labels: [...document.querySelectorAll(".ai-settings span")]
      .map((e) => e.textContent.trim())
      .filter((t) => /Proveedor|Raíz|Modelo|DeepSeek/i.test(t))
      .slice(0, 12),
  };
})()`);
console.log("settings", settings);
await shot("docs/ui-shots/desktop-ai-deepseek-settings.png");

// Sticky
const sticky = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  const clickOk = () => {
    for (const b of [...document.querySelectorAll("button")]) {
      if (/^ok$/i.test(b.textContent.trim())) b.click();
    }
  };
  const cerrar = [...document.querySelectorAll("button")].find((b) =>
    /^\\s*Cerrar\\s*$/i.test(b.textContent || ""),
  );
  if (cerrar) cerrar.click();
  await new Promise((r) => setTimeout(r, 300));
  if (typeof inv === "function") {
    await inv("propose_editor_patch", {
      patch: ["# p0 sticky", "ברא demo", "שמר panel"].join("\\n"),
    });
    await new Promise((r) => setTimeout(r, 500));
    clickOk();
    await new Promise((r) => setTimeout(r, 700));
    const gen = [...document.querySelectorAll("button")].find((b) =>
      /genesis\\.bara/i.test(b.textContent || ""),
    );
    if (gen) gen.click();
    await new Promise((r) => setTimeout(r, 600));
    clickOk();
    await new Promise((r) => setTimeout(r, 400));
    await inv("propose_editor_patch", {
      patch: ["# p0 sticky", "ברא demo", "שמר panel"].join("\\n"),
    });
    await new Promise((r) => setTimeout(r, 900));
  }
  return {
    accept: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Aceptar",
    ),
    reject: [...document.querySelectorAll("button")].some(
      (b) => b.textContent.trim() === "Rechazar",
    ),
    dock: !!document.querySelector(".ai-review-dock"),
    kernel: /kernel activo/i.test(document.body.innerText),
  };
})()`);
console.log("sticky", sticky);
await shot("docs/ui-shots/desktop-review-aceptar-rechazar.png");
await shot("docs/ui-shots/desktop-max-completa.png");
ws.close();
