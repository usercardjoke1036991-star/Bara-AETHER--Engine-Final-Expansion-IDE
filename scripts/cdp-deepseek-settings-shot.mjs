import WebSocket from "ws";
import { assertLocalCdpWs } from "./cdp-connect.mjs";
import { writeFileSync } from "fs";

const pages = await (await fetch("http://127.0.0.1:9229/json")).json();
const page =
  pages.find((p) => /AETHER|tauri|1420/i.test(p.title + p.url)) || pages[0];
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

const st = await ev(`(async () => {
  const clickTxt = (re) => {
    const b = [...document.querySelectorAll("button")].find((el) =>
      re.test(el.textContent.trim()),
    );
    if (b) {
      b.focus();
      b.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
      );
    }
    return !!b;
  };
  // Abrir dock del chat si está plegado ("Chat ▸").
  clickTxt(/^Chat/);
  await new Promise((r) => setTimeout(r, 900));
  if (!document.querySelector(".ai-settings")) {
    clickTxt(/^ajustes$/i);
    await new Promise((r) => setTimeout(r, 800));
  }
  const select = document.querySelector(".ai-settings select");
  if (!select) {
    return {
      err: "no-settings",
      btns: [...document.querySelectorAll("button")]
        .map((b) => b.textContent.trim())
        .filter((t) => /chat|ajustes|Chat|ASISTENTE/i.test(t))
        .slice(0, 20),
      hasAsistente: /ASISTENTE/i.test(document.body.innerText),
    };
  }
  select.value = "deepseek";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const deep = [...document.querySelectorAll(".ai-settings button")].find(
    (b) => b.textContent.trim() === "DeepSeek",
  );
  if (deep) deep.click();
  await new Promise((r) => setTimeout(r, 350));
  for (const inp of document.querySelectorAll(".ai-settings input[type=password]")) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(inp, "");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const root = document.querySelector('.ai-settings input[aria-label="Raíz de la API"]');
  const model = document.querySelector(".ai-settings input[list]");
  if (model) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(model, "deepseek-chat");
    model.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return {
    provider: select.value,
    root: root?.value ?? null,
    readOnly: root?.readOnly ?? null,
    deep: !!deep,
    model: model?.value ?? null,
  };
})()`);
console.log(JSON.stringify(st, null, 2));

const shot = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
});
writeFileSync(
  "docs/ui-shots/desktop-ai-deepseek-settings.png",
  Buffer.from(shot.result.data, "base64"),
);
console.log("wrote docs/ui-shots/desktop-ai-deepseek-settings.png");
ws.close();
