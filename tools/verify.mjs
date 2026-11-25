import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9450 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgeverify-"));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = list.find((t) => t.type === "page"); if (page) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.value; };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 40; i++) { if (await ev("document.documentElement.dataset.chartReady||\"\"") === "1") break; await sleep(400); }
  console.log("chartReady:", await ev("document.documentElement.dataset.chartReady||\"\"") );
  console.log("active tf:", await ev("document.querySelector(\".tf.active\").textContent"));
  console.log("legend:", await ev("document.querySelector(\".legend-ohlc\").textContent"));
  console.log("tag:", await ev("(document.querySelector(\".last-price-tag\")||{}).textContent"));
  await ev("document.querySelectorAll(\".tf\")[3].click()");
  await sleep(4000);
  console.log("after tf switch -> active:", await ev("document.querySelector(\".tf.active\").textContent"), "| tag:", await ev("(document.querySelector(\".last-price-tag\")||{}).textContent"), "| ready:", await ev("document.documentElement.dataset.chartReady||\"\"") );
  await ev("document.querySelector(\".symbol-button\").click()");
  await sleep(700);
  console.log("search open:", await ev("!!document.querySelector(\".search-modal\")"), "| rows:", await ev("document.querySelectorAll(\".search-row\").length"));
  await ev("document.querySelectorAll(\".search-row\")[2].click()");
  await sleep(3500);
  console.log("after symbol pick -> sym:", await ev("document.querySelector(\".symbol-code\").textContent"), "| title:", await ev("document.querySelector(\".chart-title\").textContent"), "| tag:", await ev("(document.querySelector(\".last-price-tag\")||{}).textContent"));
  await ev("document.querySelectorAll(\".tf\")[0].click()");
  await sleep(2500);
  console.log("back to tf:", await ev("document.querySelector(\".tf.active\").textContent"));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (err) {} process.exit(1); });
