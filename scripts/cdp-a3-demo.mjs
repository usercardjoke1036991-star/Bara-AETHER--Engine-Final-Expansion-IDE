import WebSocket from "ws";

function projectKey(root) {
  let n = String(root).replace(/\\/g, "/").trim().toLowerCase();
  n = n.replace(/^\/\/\?\//, "").replace(/^\/\?\//, "");
  return n;
}

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page = pages.find((p) => /AETHER|tauri/i.test(p.title + p.url)) || pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  const details = r.exceptionDetails || r.result?.exceptionDetails;
  if (details) {
    throw new Error(details.exception?.description || details.text || "eval failed");
  }
  return r.result?.value ?? r.result?.result?.value;
}

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});

const phase = process.argv[2] || "setup";

if (phase === "setup") {
  const out = await evalExpr(`(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const projectKey = ${projectKey.toString()};
    const panels = JSON.parse(localStorage.getItem("bara.panels.v2") || "{}");
    panels.sideMode = "files";
    panels.chatOpen = true;
    localStorage.setItem("bara.panels.v2", JSON.stringify(panels));
    const cont = [...document.querySelectorAll("button")].find((b) =>
      /Continuar con la carpeta/i.test(b.textContent || ""),
    );
    if (cont) cont.click();
    await new Promise((r) => setTimeout(r, 400));
    await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\bara-ide" });
    const s = await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\BAR" });
    const mk = (t) => ({
      id: crypto.randomUUID(),
      role: "assistant",
      text: t,
      model: "seed",
      createdAt: Date.now(),
      error: null,
      images: [],
    });
    const bucket = {};
    for (const r of s.roots) {
      bucket[projectKey(r.path)] = [
        mk(
          /bar$/i.test(r.name)
            ? "Hilo kernel BAR — distinto del IDE."
            : "Hilo IDE bara-ide — distinto del kernel.",
        ),
      ];
    }
    localStorage.setItem("bara.chat.byProject.v1", JSON.stringify(bucket));
    const bar = s.roots.find((r) => /bar$/i.test(r.name)) || s.roots[s.roots.length - 1];
    await inv("workspace_activate", { id: bar.id });
    await new Promise((r) => setTimeout(r, 700));
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand-green").trim();
    const kernel = document.querySelector(".kernel-pill")?.textContent || "";
    const browserBanner = /esta pestaña no es el IDE|kernel caído/i.test(document.body.innerText);
    return {
      roots: s.roots.map((r) => r.name),
      names: [...document.querySelectorAll(".shelf-name")].map((e) => e.textContent),
      paths: [...document.querySelectorAll(".shelf-path")].map((e) => e.textContent),
      meta: document.querySelector(".workspace-meta")?.textContent,
      chat: (document.querySelector(".ai-log")?.innerText || "").slice(0, 160),
      brand,
      kernel,
      browserBanner,
      side: !!document.querySelector(".ide-side"),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} else if (phase === "switch-ide") {
  const out = await evalExpr(`(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const s = await inv("workspace_roots");
    const ide = s.roots.find((r) => /bara-ide/i.test(r.name));
    await inv("workspace_activate", { id: ide.id });
    await new Promise((r) => setTimeout(r, 800));
    const cont = [...document.querySelectorAll("button")].find((b) =>
      /Continuar con la carpeta/i.test(b.textContent || ""),
    );
    if (cont) cont.click();
    return {
      meta: document.querySelector(".workspace-meta")?.textContent,
      chat: (document.querySelector(".ai-log")?.innerText || "").slice(0, 180),
      names: [...document.querySelectorAll(".shelf-name")].map((e) => e.textContent),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
} else if (phase === "propose") {
  const out = await evalExpr(`(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    await inv("propose_editor_patch", {
      patch: ["# sticky a3", "ברא demo", "שמר panel"].join("\\n"),
    });
    await new Promise((r) => setTimeout(r, 900));
    return {
      accept: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Aceptar"),
      reject: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Rechazar"),
      banner: (document.querySelector(".patch-banner")?.innerText || "").slice(0, 160),
      dock: !!document.querySelector(".ai-review-dock"),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
}

ws.close();
