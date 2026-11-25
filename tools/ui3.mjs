import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10120 + Math.floor(Math.random() * 30);
const profile = mkdtempSync(path.join(tmpdir(), "edgeui3-"));
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
  const clickText = (sel, txt) => ev("(()=>{const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(e=>e.textContent.trim()===" + JSON.stringify(txt) + ");if(!el)return 'missing';el.click();return 'ok';})()");
  const clickTitle = (t) => ev("(()=>{const el=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('title')||'').includes(" + JSON.stringify(t) + "));if(!el)return 'missing';el.click();return 'ok';})()");
  const waitReady = async () => { for (let i = 0; i < 120; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) return true; await sleep(250); } return false; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  await waitReady(); await sleep(2500);

  // persist chart type + indicator + grid setting, then reload
  console.log("SET_LINE " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[0].querySelector('button');b.click();return 'ok';})()"));
  await sleep(250);
  console.log("LINE_ITEM " + await clickText(".menu-item", "Chiziq"));
  await sleep(300);
  console.log("OPEN_IND " + await ev("(()=>{document.querySelectorAll('.menu-anchor')[1].querySelector('button').click();return 'ok';})()"));
  await sleep(250);
  console.log("EMA " + await clickText(".menu-item", "EMA 20"));
  await sleep(300);
  console.log("OPEN_SET " + await clickTitle("Sozlamalar"));
  await sleep(250);
  console.log("GRID_TOGGLE " + await ev("(()=>{document.querySelector('.settings-row .switch').click();return 'ok';})()"));
  await sleep(200);
  console.log("SET_CLOSE " + await ev("(()=>{document.querySelector('.settings-head button').click();return 'ok';})()"));
  await sleep(1600);
  console.log("SAVED_LAYOUT " + await ev("localStorage.getItem('fx.layout.v1')"));
  await send("Page.reload");
  await sleep(1500); await waitReady(); await sleep(2500);
  console.log("RELOAD_SERIES " + await ev("window.__series.seriesType()"));
  console.log("RELOAD_OVERLAYS " + await ev("window.__overlays"));
  console.log("RELOAD_GRID " + await ev("window.__chart.options().grid.vertLines.visible"));

  // back to candles + grid on, EMA off for the final look
  console.log("OPEN_TYPE " + await ev("(()=>{document.querySelectorAll('.menu-anchor')[0].querySelector('button').click();return 'ok';})()"));
  await sleep(250);
  console.log("CANDLES " + await clickText(".menu-item", "Shamlar"));
  await sleep(300);
  console.log("OPEN_IND2 " + await ev("(()=>{document.querySelectorAll('.menu-anchor')[1].querySelector('button').click();return 'ok';})()"));
  await sleep(250);
  console.log("EMA_OFF " + await clickText(".menu-item", "EMA 20"));
  await sleep(300);
  console.log("OPEN_SET2 " + await clickTitle("Sozlamalar"));
  await sleep(250);
  console.log("GRID_ON " + await ev("(()=>{document.querySelector('.settings-row .switch').click();return 'ok';})()"));
  await sleep(200);
  console.log("SET_CLOSE2 " + await ev("(()=>{document.querySelector('.settings-head button').click();return 'ok';})()"));

  // symbol switch through search
  console.log("OPEN_SEARCH " + await ev("(()=>{document.querySelector('.symbol-button').click();return 'ok';})()"));
  await sleep(400);
  console.log("SEARCH_INPUT " + await ev("(()=>{const i=document.querySelector('.search-input');if(!i)return 'missing';return i.tagName;})()"));
  console.log("PICK_GBP " + await ev("(()=>{const rows=[...document.querySelectorAll('.search-row')];const r=rows.find(e=>e.textContent.includes('GBPUSD'));if(!r)return 'missing';r.click();return 'ok';})()"));
  await sleep(2500);
  console.log("SYMBOL_NOW " + await ev("(()=>{const s=document.querySelector('.symbol-code');return s?s.textContent:''})()"));
  console.log("TITLE_NOW " + await ev("(()=>{const s=document.querySelector('.chart-title');return s?s.textContent:''})()"));
  console.log("BARS_NOW " + await ev("(window.__bars||[]).length"));

  // timeframe switch
  console.log("TF_5M " + await clickText(".tf-group .tf", "5m"));
  await sleep(2500);
  console.log("TF_ACTIVE " + await ev("(()=>{const b=document.querySelector('.tf-group .tf.active');return b?b.textContent:''})()"));
  console.log("DIGITS_CHECK " + await ev("(()=>{const t=document.querySelector('.last-price-value');return t?t.textContent:''})()"));
  console.log("CHART_TF " + await ev("(()=>{const s=document.querySelectorAll('.chart-title-small')[0];return s?s.textContent:''})()"));

  // range preset on the new tf
  console.log("RANGE_1D " + await clickText(".range", "1D"));
  await sleep(1200);
  console.log("RANGE_1D_STATE " + await ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return JSON.stringify({from:Math.round(r.from),to:Math.round(r.to),bars:(window.__bars||[]).length})})()"));

  // fullscreen attempt
  console.log("FULLSCREEN " + await clickTitle("Fullscreen"));
  await sleep(600);
  console.log("FULLSCREEN_STATE " + await ev("JSON.stringify({fs:!!document.fullscreenElement, toast:(document.querySelector('.toast')||{}).textContent||''})"));

  await shot("ui-final.png");
  console.log("ERRORS " + JSON.stringify(errors.slice(0, 10)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
