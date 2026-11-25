import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9800 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "edgev-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = l.find((t) => t.type === "page"); if (page) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description || ""); return r.result.value; };
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 80; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(2500);
  const pr = () => ev("JSON.stringify({ auto: window.__chart.options().rightPriceScale.autoScale, vis: window.__series.priceScale().getVisibleRange() })");
  console.log("P0 " + await pr());
  const geom = await ev(`(() => { const r = document.querySelector(".chart-host").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const cx = geom.x + Math.round(geom.w * 0.4), cy = geom.y + Math.round(geom.h * 0.5);
  const drag = async (dx, dy) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
    for (let i = 1; i <= 12; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + (dx * i) / 12, y: cy + (dy * i) / 12, button: "left" }); await sleep(16); }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + dx, y: cy + dy, button: "left", clickCount: 1 });
    await sleep(600);
  };
  await drag(0, 180);
  console.log("AFTER_VDRAG_autoscale_true " + await pr());
  await ev("window.__series.priceScale().applyOptions({ autoScale: false }); 1");
  await sleep(300);
  console.log("AUTOSCALE_OFF " + await pr());
  await drag(0, 180);
  console.log("AFTER_VDRAG_autoscale_false " + await pr());
  await ev("window.__series.priceScale().setVisibleRange({ from: 1.10, to: 1.12 }); 1");
  await sleep(500);
  console.log("AFTER_SETRANGE " + await pr());
  // double click on price axis to reset
  const axisX = geom.x + geom.w + 30;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: axisX, y: cy, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: axisX, y: cy, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: axisX, y: cy, button: "left", clickCount: 1 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: axisX, y: cy, button: "left", clickCount: 2 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: axisX, y: cy, button: "left", clickCount: 2 });
  await sleep(700);
  console.log("AFTER_DBLCLICK_AXIS " + await pr());
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
