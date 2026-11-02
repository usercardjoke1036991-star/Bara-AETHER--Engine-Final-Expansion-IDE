import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page = pages.find((p) => /AETHER|tauri/i.test(p.title + p.url)) || pages[0];
if (!page?.webSocketDebuggerUrl) {
  console.error("sin página CDP");
  process.exit(1);
}

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

await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

const expr = `(() => {
  const btns = [...document.querySelectorAll("button")];
  const cont = btns.find((b) => /Continuar con la carpeta/i.test(b.textContent || ""));
  if (cont) cont.click();
  const inv =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    (window.__TAURI__ && window.__TAURI__.invoke);
  if (typeof inv !== "function") {
    return Promise.resolve("no-invoke:" + Object.keys(window).filter((k) => /TAURI/i.test(k)).join(","));
  }
  const patch = [
    "# sticky review demo",
    "ברא hola",
    "שמר estado",
  ].join("\\n");
  return inv("propose_editor_patch", { patch }).then(() => "proposed").catch((e) => "err:" + String(e));
})()`;

const r = await send("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(r.result, null, 2));
ws.close();
