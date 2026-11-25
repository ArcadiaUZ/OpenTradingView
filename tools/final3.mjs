import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10160 + Math.floor(Math.random() * 30);
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
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR" : r.result.value; };
  const clickTitle = (t) => ev("(()=>{const el=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('title')||'').includes(" + JSON.stringify(t) + "));if(!el)return 'missing';el.click();return 'ok';})()");
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 120; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(4000);
  await ev("document.querySelector('.chart-host').dispatchEvent(new MouseEvent('mousemove',{clientX:900,clientY:400,bubbles:true}))");
  await shot("final-main.png");
  console.log("MAIN ok");
  await clickTitle("Alertlar");
  await sleep(500);
  await ev("(()=>{const i=document.querySelector('.alerts-input');if(i){i.value='1.09800';i.dispatchEvent(new Event('input',{bubbles:true}));}})()");
  await sleep(200);
  await ev("(()=>{const b=document.querySelector('.alerts-add');if(b)b.click();})()");
  await sleep(500);
  await shot("final-alerts.png");
  console.log("ALERTS ok rows=" + await ev("document.querySelectorAll('.alerts-row').length"));
  await ev("(()=>{const b=document.querySelector('.alerts-head button:last-of-type');if(b)b.click();})()");
  await sleep(300);
  await ev("document.querySelector('.trade-button').click()");
  await sleep(600);
  await ev("(()=>{const b=document.querySelector('.pp-action.buy');if(b)b.click();})()");
  await sleep(900);
  await shot("final-trade.png");
  console.log("TRADE ok pos=" + await ev("document.querySelectorAll('.pp-pos').length"));
  console.log("DONE");
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
