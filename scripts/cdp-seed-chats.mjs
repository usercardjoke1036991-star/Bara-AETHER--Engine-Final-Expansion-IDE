import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";

function projectKey(root) {
  let n = String(root).replace(/\\/g, "/").trim().toLowerCase();
  n = n.replace(/^\/\/\?\//, "").replace(/^\/\?\//, "");
  return n;
}

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

const result = await evalExpr(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const projectKey = ${projectKey.toString()};
  let s = await inv("workspace_roots");
  if (!s.roots || s.roots.length < 2) {
    await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\bara-ide" });
    s = await inv("workspace_reopen", { path: "C:\\\\Users\\\\Vexor\\\\Downloads\\\\BAR" });
  }
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
    const label = /bar$/i.test(r.name)
      ? "Hilo kernel BAR — distinto del IDE."
      : "Hilo IDE bara-ide — distinto del kernel.";
    bucket[projectKey(r.path)] = [mk(label)];
  }
  localStorage.setItem("bara.chat.byProject.v1", JSON.stringify(bucket));
  const ide = s.roots.find((r) => /bara-ide/i.test(r.name)) || s.roots[0];
  const bar = s.roots.find((r) => r !== ide) || s.roots[1];
  if (!ide || !bar) return { error: "missing roots", roots: s.roots };
  await inv("workspace_activate", { id: ide.id });
  await new Promise((r) => setTimeout(r, 900));
  const chatIde = document.querySelector(".ai-log")?.innerText || "";
  const metaIde = document.querySelector(".workspace-meta")?.textContent || "";
  await inv("workspace_activate", { id: bar.id });
  await new Promise((r) => setTimeout(r, 900));
  const chatBar = document.querySelector(".ai-log")?.innerText || "";
  const metaBar = document.querySelector(".workspace-meta")?.textContent || "";
  return {
    keys: Object.keys(bucket),
    names: [...document.querySelectorAll(".shelf-name")].map((e) => e.textContent),
    metaIde,
    metaBar,
    hasIde: /bara-ide/i.test(chatIde),
    hasBar: /kernel BAR/i.test(chatBar),
    chatBar: chatBar.slice(0, 240),
    side: !!document.querySelector(".ide-side"),
  };
})()`);

console.log(JSON.stringify(result, null, 2));
ws.close();
