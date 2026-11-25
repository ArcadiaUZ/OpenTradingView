import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10060 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "edgeui2-"));
const downloads = mkdtempSync(path.join(tmpdir(), "edge-dl-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = l.find((t) => t.type === "page"); if (page) break; } catch (e) {}
    await sleep(250);
  }
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = [];
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push("exception: " + ((d.exception && d.exception.description) || d.text)); }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || a.type).join(" "));
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "ERR " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; };
  const clickTitle = (t) => ev("(()=>{const el=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('title')||'').includes(" + JSON.stringify(t) + "));if(!el)return 'missing';el.click();return 'ok';})()");
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  const range = () => ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return JSON.stringify({from:r&&Math.round(r.from*10)/10,to:r&&Math.round(r.to*10)/10});})()");

  await send("Page.enable"); await send("Runtime.enable");
  try { await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }); } catch (e) {}
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 120; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(3000);

  // alert creates without instant fire (crossing semantics)
  console.log("OPEN_ALERTS " + await clickTitle("Alertlar"));
  await sleep(400);
  console.log("DEFAULT_PRICE " + await ev("(()=>{const i=document.querySelector('.alerts-input');return i?i.value:''})()"));
  console.log("ADD " + await ev("(()=>{const b=document.querySelector('.alerts-add');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(1600);
  console.log("ROWS " + await ev("document.querySelectorAll('.alerts-row').length"));
  console.log("BADGE_AFTER_ADD " + await ev("(()=>{const b=document.querySelector('.badge');return b?b.textContent:'none'})()"));
  console.log("TOASTS_AFTER_ADD " + await ev("document.querySelectorAll('.alerts-toast').length"));
  console.log("PANEL_OPEN " + await ev("!!document.querySelector('.alerts-panel')"));
  await shot("ui-alerts.png");
  // delete it again
  console.log("DELETE " + await ev("(()=>{const b=document.querySelector('.alerts-del');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(300);
  console.log("ROWS_AFTER_DELETE " + await ev("document.querySelectorAll('.alerts-row').length"));
  console.log("BADGE_AFTER_DELETE " + await ev("(()=>{const b=document.querySelector('.badge');return b?b.textContent:'none'})()"));
  console.log("ALERTS_CLOSE " + await ev("(()=>{const b=document.querySelector('.alerts-head button:last-of-type');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(300);

  // chart type area
  console.log("OPEN_TYPE " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[0];b.querySelector('button').click();return 'ok';})()"));
  await sleep(250);
  console.log("SET_AREA " + await ev("(()=>{const el=[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()==='Area');if(!el)return 'missing';el.click();return 'ok';})()"));
  await sleep(700);
  console.log("SERIES " + await ev("window.__series.seriesType()"));
  await shot("ui-area.png");

  // snapshot download
  console.log("SNAP_CLICK " + await clickTitle("Snapshot"));
  await sleep(1800);
  let files = [];
  try { files = readdirSync(downloads).filter((f) => f.endsWith(".png")); } catch (e) {}
  console.log("SNAP_FILES " + files.length + (files.length ? " size=" + statSync(path.join(downloads, files[0])).size : ""));

  // bottom arrows + 1D
  const before = await range();
  console.log("PAN_LEFT " + await ev("(()=>{const b=[...document.querySelectorAll('.bottombar button')].find(e=>(e.title||'').includes('Orqaga'));b.click();return 'ok';})()"));
  await sleep(500);
  console.log("PAN_BEFORE " + before + " PAN_AFTER " + await range());

  // restore candles for the final look
  console.log("OPEN_TYPE2 " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[0];b.querySelector('button').click();return 'ok';})()"));
  await sleep(250);
  console.log("SET_CANDLES " + await ev("(()=>{const el=[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()==='Shamlar');if(!el)return 'missing';el.click();return 'ok';})()"));
  await sleep(600);
  console.log("SERIES2 " + await ev("window.__series.seriesType()"));
  console.log("ERRORS " + JSON.stringify(errors.slice(0, 10)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
