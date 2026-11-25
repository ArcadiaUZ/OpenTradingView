import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10360 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgedraw-"));
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
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await new Promise((r) => { ws.onopen = () => r(null); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      const text = (m.params.args || []).map((a) => a.value || a.description || "").join(" ");
      if (text) errors.push(text.slice(0, 300));
    }
    if (m.method === "Page.javascriptDialogOpening") {
      send("Page.handleJavaScriptDialog", { accept: true, promptText: "Test izoh" }).catch(() => {});
    }
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  const mouse = async (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
  const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(120); };
  const label = (t) => ev("(()=>{const el=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('title')||'').includes(" + JSON.stringify(t) + "));if(!el)return 'missing';el.click();return 'ok';})()");
  const toolBtn = (t) => ev("(()=>{const el=document.querySelector('.draw-tool-btn[data-tool=" + JSON.stringify(t) + "]');if(!el)return 'missing';el.click();return 'ok';})()");
  const action = (a) => ev("(()=>{const el=document.querySelector('.draw-settings [data-action=" + JSON.stringify(a) + "]');if(!el)return 'missing';el.click();return 'ok';})()");
  const state = () => ev("(()=>{const u=window.__drawState?window.__drawState():null;return u;})()");

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(3500);

  const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
  console.log("HOST " + JSON.stringify(host));
  const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });

  // expose drawing state for assertions
  await ev("window.__drawState=()=>({n:document.querySelectorAll('.draw-layer .draw-item').length,sel:document.querySelector('.draw-settings')?1:0,items:[...document.querySelectorAll('.draw-layer .draw-item')].map(g=>({type:g.dataset.type,lines:g.querySelectorAll('.draw-line').length,stroke:[...g.querySelectorAll('.draw-line')].map(l=>l.getAttribute('stroke')),width:[...g.querySelectorAll('.draw-line')].map(l=>l.getAttribute('stroke-width'))}))});1");

  console.log("TOOLBAR_BTNS " + await ev("document.querySelectorAll('.draw-tool-btn[data-tool]').length"));

  const range0 = await ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return {from:Math.round(r.from),to:Math.round(r.to)};})()");

  // ---------------------------------------------------------------- o'lchash
  await label("O'lchash");
  await sleep(300);
  const m1 = P(0.32, 0.42);
  const m2 = P(0.62, 0.6);
  await clickAt(m1.x, m1.y);
  await sleep(200);
  await mouse("mouseMoved", Math.round((m1.x + m2.x) / 2), Math.round((m1.y + m2.y) / 2));
  await sleep(200);
  await clickAt(m2.x, m2.y);
  await sleep(400);
  console.log("MEASURE_BADGE " + await ev("(()=>{const b=document.querySelector('.measure-badge');return b?b.innerText.replace(/\\n/g,' | '):'missing';})()"));
  const range1 = await ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return {from:Math.round(r.from),to:Math.round(r.to)};})()");
  console.log("MEASURE_PAN " + JSON.stringify({ before: range0, after: range1 }));
  await shot("draw-measure.png");

  // ---------------------------------------------------------------- trendline
  await toolBtn("trendline");
  await sleep(200);
  const t1 = P(0.28, 0.55);
  const t2 = P(0.58, 0.3);
  await clickAt(t1.x, t1.y);
  await mouse("mouseMoved", t2.x, t2.y);
  await sleep(120);
  await clickAt(t2.x, t2.y);
  await sleep(400);
  console.log("AFTER_TRENDLINE " + JSON.stringify(await state()));
  console.log("SETTINGS_TYPE " + await ev("(()=>{const e=document.querySelector('.draw-settings .dsettings-type');return e?e.innerText:'missing';})()"));

  // rang
  await action("color");
  await sleep(200);
  await ev("(()=>{const b=document.querySelector('.dsettings-swatch[data-color=\"#26a69a\"]');if(b)b.click();return 1;})()");
  await sleep(300);
  // qalinlik
  await action("width");
  await sleep(200);
  await ev("(()=>{const b=document.querySelector('.dsettings-menu [data-width=\"3\"]');if(b)b.click();return 1;})()");
  await sleep(300);
  console.log("AFTER_STYLE " + JSON.stringify(await state()));

  // sudrash: trendline o'rtasidan ushlab siljitish
  const mid = { x: Math.round((t1.x + t2.x) / 2), y: Math.round((t1.y + t2.y) / 2) };
  await mouse("mouseMoved", mid.x, mid.y);
  await mouse("mousePressed", mid.x, mid.y, { buttons: 1 });
  await sleep(80);
  await mouse("mouseMoved", mid.x + 40, mid.y + 25, { buttons: 1 });
  await sleep(80);
  await mouse("mouseMoved", mid.x + 80, mid.y + 45, { buttons: 1 });
  await sleep(80);
  await mouse("mouseReleased", mid.x + 80, mid.y + 45, { buttons: 0 });
  await sleep(300);
  const range2 = await ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return {from:Math.round(r.from),to:Math.round(r.to)};})()");
  console.log("DRAG_PAN " + JSON.stringify({ before: range1, after: range2 }));

  // ---------------------------------------------------------------- hline
  await toolBtn("hline");
  await sleep(150);
  await clickAt(m1.x, m1.y);
  await sleep(300);
  // ---------------------------------------------------------------- rect
  await toolBtn("rect");
  await sleep(150);
  await clickAt(P(0.35, 0.35).x, P(0.35, 0.35).y);
  await clickAt(P(0.5, 0.5).x, P(0.5, 0.5).y);
  await sleep(300);
  // ---------------------------------------------------------------- text
  await toolBtn("text");
  await sleep(150);
  await clickAt(P(0.5, 0.25).x, P(0.5, 0.25).y);
  await sleep(700);
  console.log("AFTER_DRAWS " + JSON.stringify(await state()));
  await shot("draw-tools.png");

  // ---------------------------------------------------------------- duplicate / lock / delete
  await action("duplicate");
  await sleep(300);
  console.log("AFTER_DUPLICATE " + JSON.stringify(await state()));
  await action("lock");
  await sleep(300);
  console.log("AFTER_LOCK " + JSON.stringify(await ev("(()=>{const b=document.querySelector('.draw-settings [data-action=\"lock\"]');return b?b.className:'missing';})()")));
  await action("delete");
  await sleep(300);
  console.log("AFTER_DELETE " + JSON.stringify(await state()));

  // ---------------------------------------------------------------- persistence
  await ev("window.__keep=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings ? JSON.parse(localStorage.getItem('fx.drawings.v1')).drawings.length : -1");
  console.log("PERSIST " + await ev("localStorage.getItem('fx.drawings.v1')?JSON.parse(localStorage.getItem('fx.drawings.v1')).drawings.length:'none'"));
  await send("Page.reload", { ignoreCache: true });
  await sleep(1500);
  for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(2500);
  console.log("RELOAD_DRAWINGS " + await ev("document.querySelectorAll('.draw-layer .draw-item').length"));
  await shot("draw-reload.png");

  console.log("ERRORS " + JSON.stringify(errors.slice(0, 6)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}

main().catch((e) => { console.log("FAIL " + e.message); console.log("ERRORS " + JSON.stringify(errors.slice(0, 6))); try { child.kill(); } catch (x) {} process.exit(1); });
