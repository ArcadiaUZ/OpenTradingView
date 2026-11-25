
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 11720 + Math.floor(Math.random() * 60);
const profile = mkdtempSync(path.join(tmpdir(), "edgealign-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

let errors = [];
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
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "T" }).catch(() => {});
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(160); };
const toolBtn = (t) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-tool-btn[data-tool=" + t + "]") + ");if(!el)return 'missing';el.click();return 'ok';})()");
const rectOf = (sel) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(sel) + ");if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()");

// expected screen coords from chart API vs drawn SVG line
const CHECK = "(function(){window.__align = function(){" +
"  var line = document.querySelector('.draw-item[data-type=trendline] line');" +
"  if (!line) return {error:'no-line'};" +
"  var d = JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[]; var td = d.filter(function(x){return x.type==='trendline'}).pop();" +
"  if (!td) return {error:'no-drawing'};" +
"  var ts = window.__chart.timeScale(); var series = window.__series; var bars = window.__bars||[];" +
"  var idxOf = function(t){var lo=0,hi=bars.length-1;while(lo<hi){var mid=(lo+hi)>>1; if(bars[mid].time<t) lo=mid+1; else hi=mid} return bars[lo].time===t?lo:-1};" +
"  var out = [];" +
"  for (var i=0;i<2;i++){ var p=td.points[i]; var ix=idxOf(p.time); var ex=ix<0?null:ts.logicalToCoordinate(ix); var ey=series.priceToCoordinate(p.price); out.push({ex:ex===null?null:+Number(ex).toFixed(2),ey:+Number(ey).toFixed(2),idx:ix}) }" +
"  var sx=[+line.getAttribute('x1'),+line.getAttribute('x2')]; var sy=[+line.getAttribute('y1'),+line.getAttribute('y2')];" +
"  var dx1 = out[0].ex===null?null:Math.abs(out[0].ex-sx[0]); var dx2 = out[1].ex===null?null:Math.abs(out[1].ex-sx[1]);" +
"  var dy1 = Math.abs(out[0].ey-sy[0]); var dy2 = Math.abs(out[1].ey-sy[1]);" +
"  return {drawn:{x1:sx[0],y1:sy[0],x2:sx[1],y2:sy[1]}, expected:out, maxDx: dx1===null||dx2===null?null:+Math.max(dx1,dx2).toFixed(2), maxDy:+Math.max(dy1,dy2).toFixed(2)};" +
"};1})()";

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2500);
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2500);
console.log("CHECK_INSTALL " + await ev(CHECK));

const host = await rectOf(".chart-host");
const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });
console.log("TOOL " + await toolBtn("trendline"));
await sleep(120);
await clickAt(P(0.30, 0.40).x, P(0.30, 0.40).y);
await clickAt(P(0.60, 0.60).x, P(0.60, 0.60).y);
await sleep(250);
console.log("ALIGN_INIT " + JSON.stringify(await ev("window.__align()")));

// horizontal pan: drag empty chart area to the right
const panStart = P(0.85, 0.25);
await mouse("mouseMoved", panStart.x, panStart.y); await sleep(60);
await mouse("mousePressed", panStart.x, panStart.y, { buttons: 1 }); await sleep(60);
for (let i = 0; i < 10; i++) { await mouse("mouseMoved", panStart.x + i * 20, panStart.y, { buttons: 1 }); await sleep(40); }
await mouse("mouseReleased", panStart.x + 200, panStart.y, { buttons: 0 });
await sleep(400);
console.log("ALIGN_AFTER_PAN_X " + JSON.stringify(await ev("window.__align()")));

// vertical pan (price pan takeover)
const vStart = P(0.85, 0.55);
await mouse("mouseMoved", vStart.x, vStart.y); await sleep(60);
await mouse("mousePressed", vStart.x, vStart.y, { buttons: 1 }); await sleep(60);
for (let i = 0; i < 10; i++) { await mouse("mouseMoved", vStart.x, vStart.y - i * 12, { buttons: 1 }); await sleep(40); }
await mouse("mouseReleased", vStart.x, vStart.y - 120, { buttons: 0 });
await sleep(400);
console.log("ALIGN_AFTER_PAN_Y " + JSON.stringify(await ev("window.__align()")));

// time zoom via mouse wheel
await mouse("mouseWheel", P(0.5, 0.5).x, P(0.5, 0.5).y, { deltaX: 0, deltaY: -400 });
await sleep(500);
console.log("ALIGN_AFTER_ZOOM " + JSON.stringify(await ev("window.__align()")));
console.log("ALIGN_AFTER_ZOOM2 " + JSON.stringify(await ev("window.__align()")));

// verify drawing can still be selected after pan/zoom (hit test uses fresh viewport)
const line = await rectOf(".draw-item[data-type=trendline] line");
await clickAt(Math.round(line.x + line.w / 2), Math.round(line.y + line.h / 2));
await sleep(250);
console.log("SELECTED_AFTER " + await ev("document.querySelectorAll('.draw-item.selected').length"));
console.log("ERRORS " + JSON.stringify(errors.slice(0, 5)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
