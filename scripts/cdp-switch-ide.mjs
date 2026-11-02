import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const ws = new WebSocket(assertLocalCdpWs(pages[0].webSocketDebuggerUrl));
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

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});

const r = await send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const s = await inv("workspace_roots");
    const ide = s.roots.find((x) => /bara-ide/i.test(x.name));
    await inv("workspace_activate", { id: ide.id });
    await new Promise((r) => setTimeout(r, 800));
    const cont = [...document.querySelectorAll("button")].find((b) =>
      /Continuar con la carpeta/i.test(b.textContent || ""),
    );
    if (cont) cont.click();
    return {
      names: [...document.querySelectorAll(".shelf-name")].map((e) => e.textContent),
      meta: document.querySelector(".workspace-meta")?.textContent,
      chat: (document.querySelector(".ai-log")?.innerText || "").slice(0, 180),
    };
  })()`,
});
console.log(JSON.stringify(r.result?.value, null, 2));
ws.close();
