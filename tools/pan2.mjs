import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = "http://127.0.0.1:5173";
const outFile = "D:\\Project\\New folder\\tools\\pan2.png";
const port = 9500 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgepan2-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run",
  "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: "ignore" });

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      page = list.find((t) => t.type === "page");
      if (page) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result); return; }
    if (msg.method === "Runtime.exceptionThrown") errors.push("EX: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  };
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description || "");
    return r.result.value;
  };
  const snap = async (label) => {
    const s = await ev(`(() => {
      const st = window.__store ? null : null;
      const ts = window.__chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      const d = window.__bars || [];
      const vis = ts.getVisibleRange();
      return { bars: d.length, from: r ? +r.from.toFixed(1) : null, to: r ? +r.to.toFixed(1) : null,
        firstBar: d.length ? d[0].time : null, visFrom: vis ? vis.from : null,
        jump: !!document.querySelector(".jump-live"), mode: window.__lastMode || null };
    })()`);
    console.log(label + " " + JSON.stringify(s));
    return s;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  for (let i = 0; i < 80; i++) {
    if (await ev("document.documentElement.dataset.chartReady === '1' && window.__chart ? 1 : 0") === 1) break;
    await sleep(250);
  }
  await sleep(2500);
  await snap("START");
  const geom = await ev(`(() => { const r = document.querySelector(".chart-host").getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const cx = geom.x + Math.round(geom.w * 0.45);
  const cy = geom.y + Math.round(geom.h * 0.5);

  async function dragRight(px) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx - 300, y: cy, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx - 300, y: cy, button: "left", clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx - 300 + i * (px / 10), y: cy, button: "left" });
      await sleep(16);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx - 300 + px, y: cy, button: "left", clickCount: 1 });
    await sleep(500);
  }

  for (let k = 1; k <= 3; k++) { await dragRight(800); await snap("DRAG" + k); }

  // Zoom out to see more bars, then jump the view to the far left edge like a user dragging hard.
  await ev("window.__chart.timeScale().setVisibleLogicalRange({ from: 0, to: 200 }); 1");
  await sleep(2500);
  const afterEdge = await snap("AT_LEFT_EDGE");

  await ev("window.__chart.timeScale().setVisibleLogicalRange({ from: 0, to: 200 }); 1");
  await sleep(2500);
  const afterEdge2 = await snap("AT_LEFT_EDGE_2");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.data, "base64");
  writeFileSync(outFile, buf);
  console.log("SAVED " + outFile + " " + buf.length);

  // click the jump-to-live button
  await ev("(() => { const b = document.querySelector('.jump-live'); if (b) b.click(); return !!b; })()");
  await sleep(1200);
  const back = await snap("AFTER_LIVE_CLICK");

  console.log("DELTA_BARS " + (afterEdge2.bars - afterEdge.bars));
  console.log("ERRORS " + (errors.length ? errors.slice(0, 6).join(" | ") : "none"));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
