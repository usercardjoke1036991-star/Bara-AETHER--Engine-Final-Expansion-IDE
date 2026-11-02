import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";

const expr = process.argv[2] || "document.body.innerText.slice(0,800)";
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
await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
const r = await send("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(r.result, null, 2));
ws.close();
