
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 11520 + Math.floor(Math.random() * 60);
const profile = mkdtempSync(path.join(tmpdir(), "edgesc-"));
const outDir = "D:\\Project\\New folder\\tools\\shots";
mkdirSync(outDir, { recursive: true });
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
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    const text = (m.params.args || []).map((a) => a.value || a.description || "").join(" ");
    if (text) errors.push(text.slice(0, 300));
  }
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "T" }).catch(() => {});
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value; };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
const clickAt = async (x, y, mods) => { await mouse("mouseMoved", x, y, { modifiers: mods || 0 }); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1, modifiers: mods || 0 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0, modifiers: mods || 0 }); await sleep(160); };
const shot = async (name, clip) => {
  const opts = { format: "png" };
  if (clip) opts.clip = clip;
  const s = await send("Page.captureScreenshot", opts);
  writeFileSync(path.join(outDir, name), Buffer.from(s.data, "base64"));
};
const toolBtn = (t) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-tool-btn[data-tool=" + t + "]") + ");if(!el)return 'missing';el.click();return 'ok';})()");
const drawings = () => ev("(()=>{const d=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[];return d.map(x=>({type:x.type,points:x.points}))})()");
const rectOf = (sel) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(sel) + ");if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};})()");
const KEY_CTRL = { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 };
const ctrlDown = () => send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown", modifiers: 2 }, KEY_CTRL));
const ctrlUp = () => send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp", modifiers: 0 }, KEY_CTRL));
const mode = () => ev("window.__chart.options().crosshair.mode");

const HELPERS = "(function(){" +
"window.__pane = function(){var host=document.querySelector('.chart-host');var list=[].slice.call(host.querySelectorAll('canvas'));var pane=null,best=0;for(var i=0;i<list.length;i++){var r=list[i].getBoundingClientRect();var a=r.width*r.height;if(a>best){best=a;pane=list[i]}}return pane};" +
"window.__crosshairPrice = function(){" +
"  var chart=window.__chart; var model=chart._private__chartWidget._internal_model(); var ch=model._internal_crosshairSource();" +
"  if(!ch._internal_visible()) return {ok:false,reason:'hidden'};" +
"  var y=ch._internal_appliedY(); var price=window.__series.coordinateToPrice(y);" +
"  return {ok:true,y:+Number(y).toFixed(2),originY:+Number(ch._internal_originCoordY()).toFixed(2),price:Number(price)};" +
"};" +
"window.__pickBar = function(){" +
"  var bars=window.__bars||[];var series=window.__series;var chart=window.__chart;" +
"  var pane=window.__pane();var pr=pane.getBoundingClientRect();var ts=chart.timeScale();" +
"  var best=null;" +
"  for(var i=bars.length-140;i<bars.length-2;i++){ if(i<0) continue; var b=bars[i];" +
"    var x=ts.logicalToCoordinate(i); if(x===null) continue;" +
"    var yH=series.priceToCoordinate(b.high); var yL=series.priceToCoordinate(b.low); var yO=series.priceToCoordinate(b.open); var yC=series.priceToCoordinate(b.close);" +
"    if(yH===null||yL===null) continue;" +
"    var cx=pr.left+Number(x);" +
"    if(cx < pr.left+140 || cx > pr.left+pr.width-120) continue;" +
"    if(yH < pr.top+80 || yL > pr.top+pr.height-90) continue;" +
"    var probe=yH+8; var others=[yO,yC,yL]; var minOther=1e9; for(var k=0;k<others.length;k++){var d=Math.abs(probe-others[k]); if(d<minOther)minOther=d}" +
"    var score=minOther;" +
"    if(!best||score>best.score){best={i:i,time:b.time,high:b.high,low:b.low,open:b.open,close:b.close,x:cx,yH:pr.top+Number(yH),yL:pr.top+Number(yL),yO:pr.top+Number(yO),yC:pr.top+Number(yC),score:score}}" +
"  }" +
"  return best;" +
"};" +
"return 'ok'})()";

await send("Page.enable"); await send("Runtime.enable");
await send("Input.setIgnoreInputEvents", { ignore: false }).catch(() => {});
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2500);
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2600);
await send("Page.bringToFront").catch(() => {});
console.log("HELPERS " + await ev(HELPERS));

// ------------------------------------------------------- 1) Ctrl magnet mode
console.log("MODE_INITIAL " + await mode());
await ctrlDown();
await sleep(150);
console.log("MODE_CTRL " + await mode());
await ctrlUp();
await sleep(150);
console.log("MODE_RELEASE " + await mode());

// ------------------------------------------------------- 2) magnet snapping to wick
const bar = await ev("window.__pickBar()");
console.log("BAR " + JSON.stringify(bar ? { time: bar.time, high: bar.high, low: bar.low, score: +bar.score.toFixed(1), x: Math.round(bar.x), yH: Math.round(bar.yH) } : null));
const pointAt = (y) => ({ x: Math.round(bar.x), y: Math.round(y) });
const priceAtPoint = async (p) => {
  await mouse("mouseMoved", p.x, p.y, { modifiers: 0 });
  await sleep(220);
  return ev("window.__crosshairPrice()");
};

// free crosshair (no ctrl) just below the high -> price must NOT be the high
const free = await priceAtPoint(pointAt(bar.yH + 8));
console.log("FREE_AT " + JSON.stringify({ price: free.ok ? +free.price.toFixed(5) : free, high: bar.high, deltaPips: free.ok ? +(Math.abs(free.price - bar.high) * 10000).toFixed(1) : null }));
// ctrl pressed WITHOUT moving the mouse -> crosshair must snap immediately
await ctrlDown();
await sleep(300);
const pressSnap = await ev("window.__crosshairPrice()");
console.log("MAGNET_ON_PRESS " + JSON.stringify({ price: pressSnap.ok ? +pressSnap.price.toFixed(5) : pressSnap, high: bar.high, match: pressSnap.ok ? Math.abs(pressSnap.price - bar.high) < 0.00002 : false, movedY: pressSnap.ok ? +(pressSnap.y - pressSnap.originY).toFixed(1) : null }));
await ctrlUp();
await sleep(300);
const releaseSnap = await ev("window.__crosshairPrice()");
console.log("FREE_AFTER_RELEASE " + JSON.stringify({ price: releaseSnap.ok ? +releaseSnap.price.toFixed(5) : releaseSnap, high: bar.high, stillSnapped: releaseSnap.ok ? Math.abs(releaseSnap.price - bar.high) < 0.00002 : null, movedY: releaseSnap.ok ? +(releaseSnap.y - releaseSnap.originY).toFixed(1) : null }));

// ctrl held, same point -> must snap to the high (wick)
await ctrlDown();
await sleep(120);
const snapped = await priceAtPoint(pointAt(bar.yH + 8));
console.log("MAGNET_BELOW_HIGH " + JSON.stringify({ price: snapped.ok ? +snapped.price.toFixed(5) : snapped, high: bar.high, match: snapped.ok ? Math.abs(snapped.price - bar.high) < 0.00002 : false }));
// ctrl held, point above the candle high -> still the high
const above = await priceAtPoint(pointAt(bar.yH - 9));
console.log("MAGNET_ABOVE_HIGH " + JSON.stringify({ price: above.ok ? +above.price.toFixed(5) : above, high: bar.high, match: above.ok ? Math.abs(above.price - bar.high) < 0.00002 : false }));
// ctrl held, point below the low -> must snap to the low
const belowLow = await priceAtPoint(pointAt(bar.yL + 9));
console.log("MAGNET_BELOW_LOW " + JSON.stringify({ price: belowLow.ok ? +belowLow.price.toFixed(5) : belowLow, low: bar.low, match: belowLow.ok ? Math.abs(belowLow.price - bar.low) < 0.00002 : false }));
await shot("shortcut-magnet.png", { x: 0, y: 0, width: 1600, height: 900, scale: 1 });

// Ctrl (magnit) bilan chizilgan gorizontal chiziq aynan wick (high) narxiga tushishi kerak
console.log("TOOL_HLINE " + await toolBtn("hline"));
await sleep(150);
await clickAt(bar.x, bar.yH + 8, 2);
await sleep(280);
const hlines = (await drawings()).filter((x) => x.type === "hline");
const hl = hlines[hlines.length - 1];
console.log("MAGNET_ANCHOR_HLINE " + JSON.stringify({ price: hl ? +hl.points[0].price.toFixed(5) : null, high: bar.high, match: hl ? Math.abs(hl.points[0].price - bar.high) < 0.00002 : false }));

await ctrlUp();
await sleep(120);
console.log("MODE_AFTER_UP " + await mode());

// ------------------------------------------------------- 3) Shift = horizontal trendline
const host = await rectOf(".chart-host");
const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });
const a = P(0.30, 0.30);
const b = { x: a.x + 150, y: a.y + 7 };
console.log("TOOL_TRENDLINE " + await toolBtn("trendline"));
await sleep(120);
await clickAt(a.x, a.y);
await mouse("mouseMoved", b.x, b.y, { modifiers: 8 });
await sleep(80);
await clickAt(b.x, b.y, 8);
await sleep(200);
let all = await drawings();
const shifted = all.filter((x) => x.type === "trendline").pop();
console.log("SHIFT_HORIZONTAL " + JSON.stringify({ p1: shifted.points[0], p2: shifted.points[1], samePrice: Math.abs(shifted.points[0].price - shifted.points[1].price) < 1e-6 }));

// control: same slope WITHOUT shift
const c = P(0.30, 0.42);
const d = { x: c.x + 150, y: c.y + 7 };
console.log("TOOL_TRENDLINE2 " + await toolBtn("trendline"));
await sleep(120);
await clickAt(c.x, c.y);
await mouse("mouseMoved", d.x, d.y, { modifiers: 0 });
await sleep(80);
await clickAt(d.x, d.y, 0);
await sleep(200);
all = await drawings();
const plain = all.filter((x) => x.type === "trendline").pop();
console.log("NO_SHIFT_SLOPE " + JSON.stringify({ p1: plain.points[0], p2: plain.points[1], pricesDiffer: Math.abs(plain.points[0].price - plain.points[1].price) > 1e-7 }));

// diagonal 45 degrees with shift
const e1 = P(0.30, 0.58);
const e2 = { x: e1.x + 120, y: e1.y + 96 };
console.log("TOOL_TRENDLINE3 " + await toolBtn("trendline"));
await sleep(120);
await clickAt(e1.x, e1.y);
await mouse("mouseMoved", e2.x, e2.y, { modifiers: 8 });
await sleep(80);
await clickAt(e2.x, e2.y, 8);
await sleep(250);
console.log("SHIFT_45_LINE " + JSON.stringify(await ev("(()=>{const g=[...document.querySelectorAll('.draw-item[data-type=trendline]')].pop();const l=g?g.querySelector('line'):null;if(!l)return null;const x1=+l.getAttribute('x1'),y1=+l.getAttribute('y1'),x2=+l.getAttribute('x2'),y2=+l.getAttribute('y2');return {dx:+(x2-x1).toFixed(1),dy:+(y2-y1).toFixed(1),absDx:+(Math.abs(x2-x1)).toFixed(1),absDy:+(Math.abs(y2-y1)).toFixed(1),diag45: Math.abs(Math.abs(x2-x1)-Math.abs(y2-y1))<6}})()")));

// ------------------------------------------------------- 4) position drag smoothness
await clickAt(P(0.9, 0.12).x, P(0.9, 0.12).y);
console.log("TOOL_LONG " + await toolBtn("long"));
await sleep(120);
await clickAt(P(0.62, 0.62).x, P(0.62, 0.62).y);
await sleep(300);
const entryHandle = await rectOf(".draw-item.selected [data-role=entry]");
const times = [];
await mouse("mouseMoved", Math.round(entryHandle.cx), Math.round(entryHandle.cy));
await sleep(80);
await mouse("mousePressed", Math.round(entryHandle.cx), Math.round(entryHandle.cy), { buttons: 1 });
await sleep(60);
for (let i = 1; i <= 5; i++) {
  await mouse("mouseMoved", Math.round(entryHandle.cx + i * 2), Math.round(entryHandle.cy), { buttons: 1 });
  await sleep(90);
  const dr = await drawings();
  const pos = dr.filter((x) => x.type === "long").pop();
  times.push(pos.points[0].time);
}
await mouse("mouseReleased", Math.round(entryHandle.cx + 10), Math.round(entryHandle.cy), { buttons: 0 });
await sleep(200);
const distinct = new Set(times).size;
console.log("ENTRY_DRAG_TIMES " + JSON.stringify({ times, distinct, continuous: distinct >= 4 }));

// drag tracking accuracy (1 frame): target handle vs cursor
console.log("TRACK " + JSON.stringify(await ev("(async()=>{const host=document.querySelector('.chart-host');var el=document.querySelector('.draw-item.selected [data-role=target]');if(!el)return {error:'no-target'};var r=el.getBoundingClientRect();var x0=r.left+r.width/2,y0=r.top+r.height/2;var mk=function(type,x,y,buttons){return new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,screenX:x,screenY:y,button:0,buttons:buttons,pointerId:1,pointerType:'mouse',isPrimary:true})};host.dispatchEvent(mk('pointerdown',x0,y0,1));var rec=[],lastY=y0;for(var i=1;i<=30;i++){var cur=document.querySelector('.draw-item.selected [data-role=target]');var cr=cur.getBoundingClientRect();var drawn=cr.top+cr.height/2;if(i>2)rec.push(+(drawn-lastY).toFixed(1));lastY=y0-5*i;window.dispatchEvent(mk('pointermove',x0,lastY,1));await new Promise(function(res){requestAnimationFrame(function(){res(null)})})}window.dispatchEvent(mk('pointerup',x0,lastY,0));var bad=rec.filter(function(v){return Math.abs(v)>1.5}).length;return {n:rec.length,bad:bad,max:Math.max.apply(null,rec.map(Math.abs))}})()")));

// settings dialog with shortcut list
const opened = await ev("(()=>{const svg=document.querySelector('button svg.lucide-settings')||document.querySelector('svg.lucide-settings');const btn=svg?svg.closest('button'):null;if(!btn)return 'no-btn';btn.click();return 'clicked';})()");
await sleep(300);
console.log("SETTINGS_OPEN " + opened + " rows=" + await ev("document.querySelectorAll('.settings-key-row').length"));
await shot("shortcut-settings.png");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(300);
console.log("SETTINGS_CLOSED " + await ev("document.querySelectorAll('.settings-key-row').length"));
await shot("app-final.png");
console.log("ERRORS " + JSON.stringify(errors.slice(0, 8)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
