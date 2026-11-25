import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10660 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgereplay-"));
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
    if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 300));
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  const waitFor = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await ev(expr); if (v) return v; await sleep(150); } return null; };
  const replay = () => ev("window.__replay || null");
  const clickSel = (sel) => ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return 'missing';e.click();return 'ok';})()");
  const clickAction = (a) => clickSel("[data-action=\"" + a + "\"]");
  const clickText = (sel, text) => ev("(()=>{const el=[...document.querySelectorAll(" + JSON.stringify(sel) + ")].find(e=>e.textContent.trim()===" + JSON.stringify(text) + ");if(!el)return 'missing';el.click();return 'ok';})()");

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 160; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(3000);
  const liveBars = await ev("(window.__bars||[]).length");
  console.log("LIVE_BARS " + liveBars);

  // 1) replay panel
  console.log("OPEN_REPLAY " + await clickSel(".replay-launch"));
  await sleep(600);
  console.log("PANEL " + await ev("!!document.querySelector('.replay-card')"));
  const dt = await ev("(()=>{const i=document.querySelector('.replay-datetime');if(!i)return 'missing';const d=new Date(Date.now()-6*86400000);const p=n=>String(n).padStart(2,'0');const v=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return i.value;})()");
  console.log("DATETIME " + dt);
  await sleep(200);
  await shot("replay-panel.png");
  console.log("START " + await clickSel(".replay-start"));

  const started = await waitFor("window.__replay && window.__replay.active && window.__replay.bars>50 ? JSON.stringify(window.__replay) : null", 30000);
  console.log("REPLAY_START " + started);
  await sleep(1200);
  await shot("replay-chart.png");
  console.log("CONTROLS " + await ev("(()=>{const c=document.querySelector('.replay-controls');return c?c.innerText.replace(/\\n/g,' | '):'missing';})()"));
  console.log("CHART_TAG " + await ev("(()=>{const t=document.querySelector('.chart-replay-tag');return t?t.textContent:'missing';})()"));
  console.log("TICKET " + await ev("(()=>{const p=[...document.querySelectorAll('.ticket-price')].map(e=>e.textContent);return p.join(' / ');})()"));

  const base = await replay();
  // 2) step forward / back
  console.log("STEP_FWD " + await clickAction("fwd"));
  await sleep(500);
  const afterFwd = await replay();
  const fwdDelta = afterFwd.cursor - base.cursor;
  console.log("STEP_FWD_DELTA " + fwdDelta + (fwdDelta > 0 && fwdDelta % 60 === 0 ? " OK" : " BAD"));
  console.log("STEP_BACK " + await clickAction("back"));
  await sleep(500);
  const afterBack = await replay();
  const backDelta = afterBack.cursor - afterFwd.cursor;
  console.log("STEP_BACK_DELTA " + backDelta + (backDelta <= 0 && backDelta % 60 === 0 ? " OK" : " BAD"));

  // 3) play / pause
  console.log("PLAY " + await clickAction("play"));
  await sleep(2600);
  const playing = await replay();
  console.log("PLAY_ADVANCE " + (playing.cursor - afterBack.cursor) + ((playing.cursor - afterBack.cursor) >= 60 ? " OK" : " BAD"));
  console.log("PAUSE " + await clickAction("play"));
  await sleep(300);
  console.log("CONTROLS_TEXT2 " + await ev("(()=>{const c=document.querySelector('.replay-controls');return c?c.innerText.replace(/\\n/g,' | '):'missing';})()"));

  // 4) timeframe switch during replay: cursor saqlanishi kerak, boshidan boshlanmasligi kerak
  const beforeTf = await replay();
  console.log("SWITCH_5M " + await clickText(".tf-group .tf", "5m"));
  const tf5 = await waitFor("window.__replay && window.__replay.tf==='5m' && window.__replay.bars>50 ? JSON.stringify(window.__replay) : null", 30000);
  console.log("REPLAY_5M " + tf5);
  let tf5cursor = null;
  if (tf5) {
    const parsed = JSON.parse(tf5);
    tf5cursor = parsed.cursor;
    const shift = parsed.cursor - beforeTf.cursor;
    console.log("TF_CURSOR_SHIFT " + shift + (shift <= 0 && shift > -600 ? " OK" : " CHECK"));
    console.log("TF_ACTIVE_STILL " + parsed.active);
  }
  await sleep(800);
  await shot("replay-tf5.png");
  console.log("STEP_5M " + await clickAction("fwd"));
  await sleep(600);
  const after5 = await replay();
  const d5 = after5.cursor - tf5cursor;
  console.log("STEP_5M_DELTA " + d5 + (d5 > 0 && d5 % 300 === 0 ? " OK" : " BAD"));
  console.log("BACK_1M " + await clickText(".tf-group .tf", "1m"));
  const tf1 = await waitFor("window.__replay && window.__replay.tf==='1m' && window.__replay.bars>50 ? JSON.stringify(window.__replay) : null", 30000);
  console.log("REPLAY_1M_BACK " + tf1);
  console.log("NO_RESET " + (tf1 && Math.abs(JSON.parse(tf1).cursor - after5.cursor) < 120 ? "ok" : "RESET?"));

  // Timeframe almashganda O'YNASH davom etishi kerak (boshidan boshlanmasligi kerak).
  console.log("PLAY2 " + await clickAction("play"));
  await sleep(700);
  const beforeTfPlay = await replay();
  console.log("SWITCH_15M_PLAY " + await clickText(".tf-group .tf", "15m"));
  const tf15 = await waitFor("window.__replay && window.__replay.tf==='15m' && window.__replay.bars>20 ? JSON.stringify(window.__replay) : null", 30000);
  const playState = await ev("(()=>{const b=document.querySelector('.replay-controls [data-action=\"play\"]');return b?b.getAttribute('aria-pressed'):'missing';})()");
  await sleep(1800);
  const after15 = await replay();
  console.log("PLAY_ACROSS_TF " + JSON.stringify({ tf: tf15 ? JSON.parse(tf15).tf : null, pressed: playState, advanced: tf15 ? after15.cursor - JSON.parse(tf15).cursor : null, cursorShift: tf15 ? JSON.parse(tf15).cursor - beforeTfPlay.cursor : null }));
  console.log("PAUSE2 " + await clickAction("play"));
  console.log("SWITCH_BACK_1M " + await clickText(".tf-group .tf", "1m"));
  const tfBack = await waitFor("window.__replay && window.__replay.tf==='1m' && window.__replay.bars>50 ? JSON.stringify(window.__replay) : null", 30000);
  console.log("REPLAY_BACK_FOR_TRADE " + tfBack);

  // 5) paper trade at replay price
  console.log("OPEN_TRADE " + await clickSel(".trade-button"));
  await sleep(700);
  const last = (await replay()).last;
  console.log("REPLAY_LAST " + last);
  console.log("PANEL_QUOTE " + await ev("(()=>{const cells=[...document.querySelectorAll('.pp-quote-val')].map(e=>e.textContent);return cells.join(' / ');})()"));
  console.log("BUY " + await clickSel(".pp-action.buy"));
  await sleep(800);
  const pos = await ev("(()=>{const raw=localStorage.getItem('fx.paper.v1');if(!raw)return 'none';const j=JSON.parse(raw);return JSON.stringify((j.positions||[]).map(p=>({sym:p.symbol,side:p.side,entry:p.entry})));})()");
  console.log("POSITION " + pos);
  console.log("POS_ENTRY_DIFF " + await ev("(()=>{const raw=localStorage.getItem('fx.paper.v1');if(!raw)return 'none';const j=JSON.parse(raw);const p=(j.positions||[])[0];return p?Math.abs(p.entry-" + String(last) + ").toFixed(6):'none';})()"));
  console.log("PNL_BEFORE " + await ev("(()=>{const e=document.querySelector('.pp-pos-pnl');return e?e.textContent:'missing';})()"));
  await clickAction("fwd"); await sleep(400); await clickAction("fwd"); await sleep(400); await clickAction("fwd"); await sleep(700);
  console.log("PNL_AFTER " + await ev("(()=>{const e=document.querySelector('.pp-pos-pnl');return e?e.textContent:'missing';})()"));
  await shot("replay-trade.png");

  // 6) exit replay
  console.log("EXIT " + await clickAction("exit"));
  const stopped = await waitFor("window.__replay && window.__replay.active===false ? 'stopped' : null", 15000);
  console.log("REPLAY_STOP " + stopped);
  await sleep(1200);
  console.log("CONTROLS_GONE " + await ev("document.querySelector('.replay-controls')?'still':'gone'"));
  console.log("CHART_TAG_GONE " + await ev("document.querySelector('.chart-replay-tag')?'still':'gone'"));
  console.log("LIVE_BARS_AFTER " + await ev("(window.__bars||[]).length"));
  console.log("POSITIONS_AFTER_EXIT " + await ev("(()=>{const raw=localStorage.getItem('fx.paper.v1');if(!raw)return 0;const j=JSON.parse(raw);return (j.positions||[]).length;})()"));
  await shot("replay-exit.png");

  console.log("ERRORS " + JSON.stringify(errors.slice(0, 6)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); console.log("ERRORS " + JSON.stringify(errors.slice(0, 6))); try { child.kill(); } catch (x) {} process.exit(1); });
