import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10010 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgeui-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

async function main() {
  let page = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = l.find((t) => t.type === "page"); if (page) break; } catch (e) {}
    await sleep(250);
  }
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = [];
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push("exception: " + ((d.exception && d.exception.description) || d.text || "?"));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || a.type).join(" "));
    }
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "ERR " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const clickSel = (sel) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(sel) + ");if(!el)return 'missing';el.click();return 'ok';})()");
  const clickText = (sel, txt) => ev("(()=>{const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(e=>e.textContent.trim()===" + JSON.stringify(txt) + ");if(!el)return 'missing';el.click();return 'ok';})()");
  const clickTitle = (title) => ev("(()=>{const el=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('title')||'').includes(" + JSON.stringify(title) + "));if(!el)return 'missing';el.click();return 'ok';})()");
  const range = () => ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return JSON.stringify({from:r&&Math.round(r.from*10)/10,to:r&&Math.round(r.to*10)/10,bars:(window.__bars||[]).length});})()");

  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64"));
  };

  await send("Page.enable"); await send("Runtime.enable");
  const nav = await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 120; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(3000);

  console.log("RIGHT_RAIL " + await ev("document.querySelectorAll('.right-rail').length"));
  console.log("LEFT_BTNS " + await ev("document.querySelectorAll('.left-rail .rail-btn').length"));
  console.log("BARS_START " + await range());
  console.log("AUTOCHIP " + await ev("!!document.querySelector('.auto-chip')"));

  // bottom range presets
  console.log("CLICK_1D " + await clickText(".range", "1D"));
  await sleep(900);
  console.log("RANGE_1D " + await range());
  console.log("CLICK_5D " + await clickText(".range", "5D"));
  for (let i = 0; i < 40; i++) {
    const loading = await ev("(()=>{const s=document.querySelector('.range-group .range.active');return s?s.textContent:''})()");
    const b = await ev("(window.__bars||[]).length");
    if (b >= 6500 && loading !== "…") break;
    await sleep(500);
  }
  console.log("RANGE_5D " + await range());
  console.log("CLICK_ALL " + await clickText(".range", "All"));
  await sleep(600);
  console.log("RANGE_ALL " + await range());

  // chart type menu
  console.log("OPEN_TYPE_MENU " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[0];if(!b)return 'missing';b.querySelector('button').click();return document.querySelector('.menu')?'open':'closed';})()"));
  await sleep(200);
  console.log("SET_LINE " + await clickText(".menu-item", "Chiziq"));
  await sleep(700);
  console.log("SERIES_TYPE " + await ev("window.__series && window.__series.seriesType ? window.__series.seriesType() : 'n/a'"));
  console.log("OPEN_TYPE_MENU2 " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[0];b.querySelector('button').click();return 'ok';})()"));
  await sleep(200);
  console.log("SET_CANDLES " + await clickText(".menu-item", "Shamlar"));
  await sleep(700);
  console.log("SERIES_TYPE2 " + await ev("window.__series && window.__series.seriesType ? window.__series.seriesType() : 'n/a'"));

  // indicators menu
  console.log("OPEN_IND_MENU " + await ev("(()=>{const b=document.querySelectorAll('.menu-anchor')[1];if(!b)return 'missing';b.querySelector('button').click();return document.querySelectorAll('.menu').length;})()"));
  await sleep(200);
  console.log("EMA20 " + await clickText(".menu-item", "EMA 20"));
  await sleep(300);
  console.log("BOLL " + await clickText(".menu-item", "Bollinger (20, 2)"));
  await sleep(700);
  console.log("OVERLAYS " + await ev("window.__overlays"));
  console.log("IND_CHECK " + await ev("document.querySelectorAll('.menu .check').length"));

  // settings
  console.log("OPEN_SETTINGS " + await clickTitle("Sozlamalar"));
  await sleep(300);
  console.log("SETTINGS_MODAL " + await ev("!!document.querySelector('.settings-modal')"));
  console.log("GRID_BEFORE " + await ev("JSON.stringify(window.__chart.options().grid.vertLines.visible)"));
  console.log("TOGGLE_GRID " + await ev("(()=>{const b=document.querySelector('.settings-row .switch');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(300);
  console.log("GRID_AFTER " + await ev("JSON.stringify(window.__chart.options().grid.vertLines.visible)"));
  console.log("CLOSE_SETTINGS " + await ev("(()=>{const b=document.querySelector('.settings-head button');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(250);
  console.log("SETTINGS_GONE " + await ev("!document.querySelector('.settings-modal')"));

  // alerts panel + add
  console.log("OPEN_ALERTS " + await clickTitle("Alertlar"));
  await sleep(400);
  console.log("ALERTS_PANEL " + await ev("!!document.querySelector('.alerts-panel')"));
  console.log("ALERT_DEFAULT_PRICE " + await ev("(()=>{const i=document.querySelector('.alerts-input');return i?i.value:''})()"));
  console.log("ALERT_ADD " + await ev("(()=>{const b=document.querySelector('.alerts-add');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(500);
  console.log("ALERT_ROWS " + await ev("document.querySelectorAll('.alerts-row').length"));
  console.log("ALERT_BADGE " + await ev("(()=>{const b=document.querySelector('.badge');return b?b.textContent:''})()"));
  console.log("ALERTS_CLOSE " + await ev("(()=>{const b=document.querySelector('.alerts-head button:last-of-type');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(300);

  // paper trade
  console.log("OPEN_TRADE " + await clickSel(".trade-button"));
  await sleep(500);
  console.log("TRADE_PANEL " + await ev("!!document.querySelector('.pp-panel')"));
  console.log("TRADE_BUY " + await ev("(()=>{const b=document.querySelector('.pp-action.buy');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(700);
  console.log("POSITIONS " + await ev("(()=>{try{const raw=localStorage.getItem('fx.paper.v1');if(!raw)return 0;const j=JSON.parse(raw);return (j.positions||[]).length;}catch(e){return 'err'}})()"));
  console.log("POS_ROWS " + await ev("document.querySelectorAll('.pp-pos').length"));
  await shot("ui-trade.png");
  console.log("TRADE_CLOSE " + await ev("(()=>{const b=document.querySelector('.pp-x');if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(300);

  // measure tool — TradingView uslubida: bos -> yurgiz -> yana bos (tortish emas)
  console.log("SET_MEASURE " + await clickTitle("lchash"));
  await sleep(250);
  const geom = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})()");
  const cx = geom.x + Math.round(geom.w * 0.45), cy = geom.y + Math.round(geom.h * 0.55);
  const cx2 = cx + 240, cy2 = cy - 130;
  const mclick = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
  };
  const rangeBeforeMeasure = await range();
  await mclick(cx, cy);
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx2, y: cy2 });
  await sleep(200);
  await mclick(cx2, cy2);
  await sleep(300);
  console.log("MEASURE_BADGE " + await ev("(()=>{const b=document.querySelector('.measure-badge');return b?b.innerText.replace(/\\n/g,' | '):'missing';})()"));
  console.log("MEASURE_NO_PAN " + JSON.stringify({ before: rangeBeforeMeasure, after: await range() }));
  await shot("ui-measure.png");
  console.log("BACK_CURSOR " + await clickTitle("Kursor"));

  // zoom buttons
  const r1 = await range();
  console.log("ZOOM_BEFORE " + r1);
  console.log("ZOOM_IN " + await ev("(()=>{const b=[...document.querySelectorAll('.left-rail .rail-btn')].find(e=>(e.title||'').includes('Yaqin'));if(!b)return 'missing';b.click();return 'ok';})()"));
  await sleep(500);
  console.log("ZOOM_AFTER " + await range());

  // MT5 popover
  console.log("OPEN_MT5 " + await clickSel(".account-button"));
  await sleep(300);
  console.log("MT5_POP " + await ev("!!document.querySelector('.status-pop')"));
  console.log("MT5_TEXT " + await ev("(()=>{const p=document.querySelector('.status-pop');return p?p.textContent.replace(/\\s+/g,' ').slice(0,140):''})()"));
  console.log("CLOSE_MT5 " + await ev("(()=>{document.querySelector('.account-button').click();return 'ok';})()"));
  await sleep(300);
  await shot("ui-main.png");

  console.log("ERRORS " + JSON.stringify(errors.slice(0, 12)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); try { child.kill(); } catch (x) {} process.exit(1); });
