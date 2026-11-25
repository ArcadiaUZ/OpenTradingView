import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10560 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgedraw3-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let errors = [];

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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 250));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 250));
    if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "Matn" }).catch(() => {});
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
  const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(30); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(30); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(120); };
  const toolBtn = (t) => ev("(()=>{const el=document.querySelector('.draw-tool-btn[data-tool=" + JSON.stringify(t) + "]');if(!el)return 'missing';el.click();return 'ok';})()");
  const items = () => ev("document.querySelectorAll('.draw-layer .draw-item:not(.draft)').length");
  const clickText = (sel, text) => ev("(()=>{const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(e=>e.textContent.trim()===" + JSON.stringify(text) + ");if(!el)return 'missing';el.click();return 'ok';})()");
  const waitReady = async () => { for (let i = 0; i < 160; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); } await sleep(2500); };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  await waitReady();
  const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
  const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });

  // draw trendline + hline on 1m
  await toolBtn("trendline"); await sleep(150);
  await clickAt(P(0.2, 0.62).x, P(0.2, 0.62).y);
  await clickAt(P(0.42, 0.36).x, P(0.42, 0.36).y);
  await sleep(250);
  await toolBtn("hline"); await sleep(150);
  await clickAt(P(0.5, 0.52).x, P(0.5, 0.52).y);
  await sleep(300);
  console.log("DRAWN_1M " + await items());

  // timeframe switch 1m -> 5m: chizmalar vaqt bo'yicha bog'langan, yo'qolmasligi kerak
  console.log("TF_5M " + await clickText(".tf-group .tf", "5m"));
  await sleep(3000);
  console.log("DRAWN_5M " + await items());
  console.log("TF_ACTIVE " + await ev("(()=>{const b=document.querySelector('.tf-group .tf.active');return b?b.textContent:'';})()"));
  console.log("TF_1M " + await clickText(".tf-group .tf", "1m"));
  await sleep(3000);
  console.log("DRAWN_BACK_1M " + await items());

  // symbol switch: chizmalar har instrument uchun alohida
  console.log("OPEN_SEARCH " + await ev("(()=>{document.querySelector('.symbol-button').click();return 'ok';})()"));
  await sleep(500);
  console.log("PICK_GBP " + await ev("(()=>{const rows=[...document.querySelectorAll('.search-row')];const r=rows.find(e=>e.textContent.includes('GBPUSD'));if(!r)return 'missing';r.click();return 'ok';})()"));
  await sleep(3000);
  console.log("SYMBOL_NOW " + await ev("(()=>{const s=document.querySelector('.symbol-code');return s?s.textContent:'';})()"));
  console.log("DRAWN_GBP " + await items());
  console.log("OPEN_SEARCH2 " + await ev("(()=>{document.querySelector('.symbol-button').click();return 'ok';})()"));
  await sleep(500);
  console.log("PICK_EUR " + await ev("(()=>{const rows=[...document.querySelectorAll('.search-row')];const r=rows.find(e=>e.textContent.includes('EURUSD'));if(!r)return 'missing';r.click();return 'ok';})()"));
  await sleep(3000);
  console.log("DRAWN_EUR_BACK " + await items());

  // deselect by clicking empty chart
  const empty = P(0.85, 0.8);
  await clickAt(empty.x, empty.y);
  await sleep(300);
  console.log("DESELECTED " + await ev("document.querySelector('.draw-settings')?0:1"));

  // measure + Escape
  console.log("SET_MEASURE " + await ev("(()=>{const b=[...document.querySelectorAll('.left-rail .rail-btn')].find(e=>(e.title||'').includes('lchash'));if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(200);
  const m1 = P(0.4, 0.45), m2 = P(0.6, 0.65);
  await clickAt(m1.x, m1.y); await sleep(150);
  await mouse("mouseMoved", m2.x, m2.y); await sleep(150);
  await clickAt(m2.x, m2.y); await sleep(350);
  console.log("MEASURE_TEXT " + await ev("(()=>{const b=document.querySelector('.measure-badge');return b?b.innerText.replace(/\\n/g,' | '):'missing';})()"));
  await ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await sleep(300);
  console.log("MEASURE_AFTER_ESC " + await ev("document.querySelector('.measure-badge')?'still':'cleared'"));
  console.log("ESC_RAIL " + await ev("(()=>{const b=document.querySelector('.left-rail .rail-btn.active');return b?b.title:'none';})()"));
  console.log("ESC_HINT " + await ev("document.querySelector('.measure-hint')?'still':'cleared'"));

  // hide / show / clear
  await ev("(()=>{const b=document.querySelector('.draw-toolbar [data-action=\"hide\"]');if(b)b.click();return 1;})()");
  await sleep(300);
  console.log("HIDDEN " + await items());
  await ev("(()=>{const b=document.querySelector('.draw-toolbar [data-action=\"hide\"]');if(b)b.click();return 1;})()");
  await sleep(300);
  console.log("SHOWN " + await items());
  await shot("draw-final.png");
  console.log("CLEAR " + await ev("(()=>{const b=document.querySelector('.draw-toolbar [data-action=\"clear\"]');if(b)b.click();return 'ok';})()"));
  await sleep(400);
  console.log("AFTER_CLEAR " + await items());
  console.log("CLEAR_TOAST " + await ev("(()=>{const t=document.querySelector('.toast');return t?t.innerText:'missing';})()"));

  console.log("ERRORS " + JSON.stringify(errors.slice(0, 5)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); console.log("ERRORS " + JSON.stringify(errors.slice(0, 5))); try { child.kill(); } catch (x) {} process.exit(1); });
