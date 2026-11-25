import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] || "http://127.0.0.1:5173";
const outFile = process.argv[3] || "D:\\Project\\New folder\\pan.png";
const port = 9400 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgepan-"));

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--window-size=1920,872", "--remote-debugging-port=" + port,
  "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/list");
      const list = await res.json();
      page = list.find((t) => t.type === "page");
      if (page) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!page) throw new Error("no page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  await new Promise((res) => { ws.onopen = () => res(null); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  };
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "ERR " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs("document.documentElement.dataset.chartReady === '1' && window.__chart ? 1 : 0");
    if (ready === 1) break;
    await sleep(250);
  }
  await sleep(1500);

  console.log("OPTIONS " + JSON.stringify(await evalJs(`(() => {
    const c = window.__chart;
    const o = c.options();
    return { handleScroll: o.handleScroll, handleScale: o.handleScale, autoSize: o.autoSize,
      timeScale: { rightOffset: o.timeScale.rightOffset, barSpacing: o.timeScale.barSpacing,
        minBarSpacing: o.timeScale.minBarSpacing, maxBarSpacing: o.timeScale.maxBarSpacing,
        shiftVisibleRangeOnNewBar: o.timeScale.shiftVisibleRangeOnNewBar,
        allowShiftVisibleRangeOnWhitespace: o.timeScale.allowShiftVisibleRangeOnWhitespace },
      priceScaleAuto: o.rightPriceScale.autoScale };
  })()`)));

  const geom = await evalJs(`(() => { const h = document.querySelector(".chart-host"); const r = h.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  console.log("HOST " + JSON.stringify(geom));

  const range = () => evalJs("JSON.stringify({ logical: window.__chart.timeScale().getVisibleLogicalRange(), visible: window.__chart.timeScale().getVisibleRange() })");
  console.log("RANGE0 " + await range());

  const cx = geom.x + Math.round(geom.w * 0.5);
  const cy = geom.y + Math.round(geom.h * 0.5);

  // DRAG: press, move left in steps, release
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + i * 40, y: cy, button: "left" });
    await sleep(20);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 400, y: cy, button: "left", clickCount: 1 });
  await sleep(300);
  console.log("RANGE_AFTER_DRAG " + await range());
  await sleep(2500);
  console.log("RANGE_AFTER_2.5s " + await range());

  // WHEEL
  const before = await evalJs("window.__chart.timeScale().getVisibleLogicalRange().from");
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: -300 });
  await sleep(400);
  const after = await evalJs("window.__chart.timeScale().getVisibleLogicalRange().from");
  console.log("WHEEL from " + before + " -> " + after);

  // WHEEL horizontal (shift-style)
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: -300, deltaY: 0 });
  await sleep(400);
  console.log("WHEEL X " + await evalJs("window.__chart.timeScale().getVisibleLogicalRange().from"));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.data, "base64");
  writeFileSync(outFile, buf);
  console.log("SAVED " + outFile + " " + buf.length);
  try { await send("Browser.close"); } catch (e) {}
  ws.close();
  child.kill();
  process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
