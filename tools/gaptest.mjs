import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9650 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgegap-"));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,600", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) { try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = list.find((t) => t.type === "page"); if (page) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "EXC " + r.exceptionDetails.text; return r.result && r.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 40; i++) { if (await ev("document.documentElement.dataset.chartReady||\"\"") === "1") break; await sleep(400); }
  const res = await ev("(() => { const s = window.__series; if (!s) return \"no series\"; const t0 = 1795500000; const bars = []; for (let i = 0; i < 10; i++) { if (i === 5) continue; bars.push({ time: t0 + i * 60, open: 1.1, high: 1.1002, low: 1.0998, close: 1.1001 }); } s.setData(bars); window.__chart.timeScale().fitContent(); return bars.length + \" bars with 5-min hole\"; })()");
  console.log("test:", res);
  await sleep(1200);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:\\Project\\New folder\\gaptest.png", Buffer.from(shot.data, "base64"));
  console.log("saved gaptest.png");
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (err) {} process.exit(1); });
