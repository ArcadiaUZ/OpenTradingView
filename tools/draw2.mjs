import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10440 + Math.floor(Math.random() * 50);
const profile = mkdtempSync(path.join(tmpdir(), "edgedraw2-"));
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
    if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "Yangilangan matn" }).catch(() => {});
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
  const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
  const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(30); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(30); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(120); };
  const toolBtn = (t) => ev("(()=>{const el=document.querySelector('.draw-tool-btn[data-tool=" + JSON.stringify(t) + "]');if(!el)return 'missing';el.click();return 'ok';})()");
  const action = (a) => ev("(()=>{const el=document.querySelector('.draw-settings [data-action=" + JSON.stringify(a) + "]');if(!el)return 'missing';el.click();return 'ok';})()");
  const items = () => ev("(()=>{return [...document.querySelectorAll('.draw-layer .draw-item')].map(g=>({type:g.dataset.type,line:(()=>{const l=g.querySelector('.draw-line');return l?[Math.round(+l.getAttribute('x1')),Math.round(+l.getAttribute('y1')),Math.round(+l.getAttribute('x2')),Math.round(+l.getAttribute('y2')),l.getAttribute('stroke'),l.getAttribute('stroke-width'),l.getAttribute('stroke-dasharray')]:null;})(),rect:(()=>{const r=g.querySelector('.draw-rect');return r?[Math.round(+r.getAttribute('x')),Math.round(+r.getAttribute('y')),Math.round(+r.getAttribute('width')),Math.round(+r.getAttribute('height')),r.getAttribute('fill')]:null;})(),text:(()=>{const t=g.querySelector('text');return t?t.textContent:null;})()}));})()");
  const range = () => ev("(()=>{const r=window.__chart.timeScale().getVisibleLogicalRange();return [Math.round(r.from),Math.round(r.to)];})()");

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:5173" });
  for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
  await sleep(3000);
  const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
  const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });

  // trendline
  await toolBtn("trendline"); await sleep(150);
  const a = P(0.25, 0.6), b = P(0.55, 0.32);
  await clickAt(a.x, a.y); await clickAt(b.x, b.y); await sleep(300);
  const before = await items();
  const r0 = await range();
  const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  await mouse("mouseMoved", mid.x, mid.y);
  await mouse("mousePressed", mid.x, mid.y, { buttons: 1 }); await sleep(60);
  await mouse("mouseMoved", mid.x + 60, mid.y + 50, { buttons: 1 }); await sleep(60);
  await mouse("mouseMoved", mid.x + 120, mid.y + 90, { buttons: 1 }); await sleep(60);
  await mouse("mouseReleased", mid.x + 120, mid.y + 90, { buttons: 0 }); await sleep(300);
  const after = await items();
  console.log("DRAG_MOVE " + JSON.stringify({ before: before[0].line, after: after[0].line }));
  console.log("DRAG_NO_PAN " + JSON.stringify({ before: r0, after: await range() }));

  // style menu: dashed + width 2
  await action("settings"); await sleep(250);
  console.log("STYLE_PANEL " + await ev("document.querySelectorAll('.dsettings-panel .dsettings-style').length"));
  await ev("(()=>{const b=document.querySelector('.dsettings-panel [data-style=\"dashed\"]');if(b)b.click();return 1;})()"); await sleep(250);
  await ev("(()=>{const b=document.querySelector('.dsettings-panel .dsettings-size');return b?1:0;})()");
  await action("width"); await sleep(200);
  await ev("(()=>{const b=document.querySelector('.dsettings-menu [data-width=\"2\"]');if(b)b.click();return 1;})()"); await sleep(250);
  console.log("AFTER_DASH " + JSON.stringify((await items())[0].line));

  // color palette screenshot
  await action("color"); await sleep(300);
  await shot("draw-settings.png");
  await ev("document.body.click()"); await sleep(200);

  // rectangle + fill check
  await toolBtn("rect"); await sleep(120);
  await clickAt(P(0.35, 0.4).x, P(0.35, 0.4).y); await clickAt(P(0.5, 0.55).x, P(0.5, 0.55).y); await sleep(250);
  const rectItem = (await items()).find((i) => i.type === "rect");
  console.log("RECT " + JSON.stringify(rectItem));

  // text + double-click edit
  await toolBtn("text"); await sleep(120);
  await clickAt(P(0.6, 0.2).x, P(0.6, 0.2).y); await sleep(700);
  const textItem = (await items()).find((i) => i.type === "text");
  console.log("TEXT " + JSON.stringify(textItem));
  await mouse("mouseMoved", P(0.6, 0.2).x + 12, P(0.6, 0.2).y - 4);
  await mouse("mousePressed", P(0.6, 0.2).x + 12, P(0.6, 0.2).y - 4, { buttons: 1 });
  await mouse("mouseReleased", P(0.6, 0.2).x + 12, P(0.6, 0.2).y - 4, { buttons: 0 });
  await sleep(150);
  await mouse("mousePressed", P(0.6, 0.2).x + 12, P(0.6, 0.2).y - 4, { buttons: 1, clickCount: 2 });
  await mouse("mouseReleased", P(0.6, 0.2).x + 12, P(0.6, 0.2).y - 4, { buttons: 0, clickCount: 2 });
  await sleep(700);
  console.log("TEXT_EDIT " + JSON.stringify((await items()).filter((i) => i.type === "text").map((i) => i.text)));

  // hline + alert
  await toolBtn("hline"); await sleep(120);
  await clickAt(P(0.45, 0.5).x, P(0.45, 0.5).y); await sleep(300);
  const hline = (await items()).find((i) => i.type === "hline");
  console.log("HLINE " + JSON.stringify(hline));
  await action("alert"); await sleep(500);
  console.log("ALERT_TOAST " + await ev("(()=>{const t=document.querySelector('.toast');return t?t.innerText:'missing';})()"));
  console.log("ALERT_BADGE " + await ev("(()=>{const b=document.querySelector('.badge');return b?b.innerText:'none';})()"));

  // toolbar drag
  const tb0 = await ev("(()=>{const r=document.querySelector('.draw-toolbar').getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)];})()");
  const grip = await ev("(()=>{const r=document.querySelector('.draw-toolbar-grip').getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];})()");
  await mouse("mouseMoved", grip[0], grip[1]);
  await mouse("mousePressed", grip[0], grip[1], { buttons: 1 }); await sleep(50);
  await mouse("mouseMoved", grip[0] + 120, grip[1] + 60, { buttons: 1 }); await sleep(50);
  await mouse("mouseReleased", grip[0] + 120, grip[1] + 60, { buttons: 0 }); await sleep(300);
  const tb1 = await ev("(()=>{const r=document.querySelector('.draw-toolbar').getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)];})()");
  console.log("TOOLBAR_DRAG " + JSON.stringify({ before: tb0, after: tb1 }));

  // escort: Escape clears drawing tool
  await ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await sleep(200);
  console.log("ESC_ACTIVE " + await ev("document.querySelectorAll('.draw-tool-btn.active[data-tool]').length"));

  await shot("draw-main.png");
  console.log("TOTAL_DRAWINGS " + (await items()).length);
  console.log("ERRORS " + JSON.stringify(errors.slice(0, 5)));
  try { await send("Browser.close"); } catch (e) {}
  ws.close(); child.kill(); process.exit(0);
}
main().catch((e) => { console.log("FAIL " + e.message); console.log("ERRORS " + JSON.stringify(errors.slice(0, 5))); try { child.kill(); } catch (x) {} process.exit(1); });
