import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9950 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "edgev4-"));
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
  const st = () => ev("JSON.stringify({ auto: window.__chart.options().rightPriceScale.autoScale, chip: !!document.querySelector('.auto-chip') })");
  const geom = await ev(`(() => { const r = document.querySelector(".chart-host").getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const cx = geom.x + Math.round(geom.w * 0.4), cy = geom.y + Math.round(geom.h * 0.5);
  // unlock via vertical drag, then drag horizontally away so the price sits mid-air like TradingView
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
  for (let i = 1; i <= 14; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy - i * 10, button: "left" }); await sleep(16); }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy - 140, button: "left", clickCount: 1 });
  await sleep(600);
  console.log("MANUAL " + await st());
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx - 200, y: geom.y + 20, button: "none" });
  await sleep(300);
  let shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:\\Project\\New folder\\tools\\manual.png", Buffer.from(shot.data, "base64"));

  // double click on the price axis => back to auto
  const axisX = geom.x + geom.w - 40;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: axisX, y: cy, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: axisX, y: cy, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: axisX, y: cy, button: "left", clickCount: 1 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: axisX, y: cy, button: "left", clickCount: 2 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: axisX, y: cy, button: "left", clickCount: 2 });
  await sleep(800);
  console.log("AFTER_DBLCLICK " + await st());
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });