import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9550 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgedata-"));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1879,816", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) { try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = list.find((t) => t.type === "page"); if (page) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "EXC " + JSON.stringify(r.exceptionDetails.text); return r.result && r.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 40; i++) { if (await ev("document.documentElement.dataset.chartReady||\"\"") === "1") break; await sleep(400); }
  const stats = async (label) => {
    const s = await ev("(() => { const b = window.__bars || []; const fmt = (t) => new Date(t*1000).toLocaleTimeString(\"en-GB\",{timeZone:\"Asia/Tashkent\"}); const gaps=[]; for (let i=1;i<b.length;i++){const d=b[i].time-b[i-1].time; if(d!==60) gaps.push({at:fmt(b[i-1].time), next:fmt(b[i].time), sec:d});} return {n:b.length, first: b.length?fmt(b[0].time):null, last: b.length?fmt(b[b.length-1].time):null, gaps: gaps.slice(-12), gapCount: gaps.length}; })()");
    console.log(label, JSON.stringify(s));
  };
  await stats("INITIAL");
  await sleep(70000);
  await stats("AFTER 70s");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:\\Project\\New folder\\shot.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot saved");
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (err) {} process.exit(1); });
