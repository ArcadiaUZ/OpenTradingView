import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9700 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "edgefin-"));
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
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "ERR"; return r.result.value; };
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 80; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(2500);
  const before = await ev("window.__bars.length");
  // jump deep: set range near left edge twice so two history pages load
  await ev("window.__chart.timeScale().setVisibleLogicalRange({ from: 0, to: 220 }); 1");
  await sleep(2200);
  await ev("window.__chart.timeScale().setVisibleLogicalRange({ from: 0, to: 220 }); 1");
  await sleep(2200);
  await ev("window.__chart.timeScale().setVisibleLogicalRange({ from: 5, to: 180 }); 1");
  await sleep(600);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 40, button: "none" });
  await sleep(400);
  const after = await ev("window.__bars.length");
  const r = await ev("JSON.stringify({ len: window.__bars.length, first: window.__bars[0].time, range: window.__chart.timeScale().getVisibleLogicalRange(), jump: !!document.querySelector('.jump-live') })");
  console.log("BEFORE " + before + " AFTER " + after + " " + r);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:\\Project\\New folder\\tools\\deep.png", Buffer.from(shot.data, "base64"));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
