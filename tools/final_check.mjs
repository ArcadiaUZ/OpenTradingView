import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9750 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgefinal-"));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1853,856", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) { try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = list.find((t) => t.type === "page"); if (page) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); } };
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "EXC"; return r.result && r.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 40; i++) { if (await ev("document.documentElement.dataset.chartReady||\"\"") === "1") break; await sleep(400); }
  const snap = async (label) => {
    const s = await ev("(() => { const b = window.__bars || []; const fmt = (t) => new Date(t*1000).toLocaleTimeString(\"en-GB\",{timeZone:\"Asia/Tashkent\"}); let gaps = 0; for (let i=1;i<b.length;i++) if (b[i].time-b[i-1].time !== 60) gaps++; return { n: b.length, first: b.length?fmt(b[0].time):null, last: b.length?fmt(b[b.length-1].time):null, gaps: gaps, age: b.length ? Math.floor(Date.now()/1000) - b[b.length-1].time : null }; })()");
    console.log(label, JSON.stringify(s));
  };
  await snap("T0");
  await sleep(95000);
  await snap("T+95s");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:\\Project\\New folder\\shot.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot saved");
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (err) {} process.exit(1); });
