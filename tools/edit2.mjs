
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10520 + Math.floor(Math.random() * 60);
const profile = mkdtempSync(path.join(tmpdir(), "edgeedit2-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,872",
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
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "Test" }).catch(() => {});
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(140); };
const drag = async (x1, y1, x2, y2, steps = 4) => {
  await mouse("mouseMoved", x1, y1); await sleep(60);
  await mouse("mousePressed", x1, y1, { buttons: 1 }); await sleep(70);
  for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", Math.round(x1 + (x2 - x1) * i / steps), Math.round(y1 + (y2 - y1) * i / steps), { buttons: 1 }); await sleep(60); }
  await mouse("mouseReleased", x2, y2, { buttons: 0 }); await sleep(220);
};
const toolBtn = (t) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-tool-btn[data-tool=" + t + "]") + ");if(!el)return 'missing';el.click();return 'ok';})()");
const store = () => ev("(()=>{try{const d=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[];return d;}catch(e){return 'ERR '+e.message;}})()");
const handlesRel = () => ev("(()=>[...document.querySelectorAll('.draw-layer .draw-item.selected .draw-handle')].map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy')})))()");
const last = async () => { const all = await store(); return Array.isArray(all) && all.length ? all[all.length - 1] : null; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3500);
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3000);

const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });
const abs = (h) => ({ x: Math.round(host.x + h.x), y: Math.round(host.y + h.y) });

// ------------------------------------------------------------ 1. trendline
console.log("TOOL " + await toolBtn("trendline"));
await sleep(150);
await clickAt(P(0.30, 0.62).x, P(0.30, 0.62).y);
await mouse("mouseMoved", P(0.60, 0.34).x, P(0.60, 0.34).y); await sleep(100);
await clickAt(P(0.60, 0.34).x, P(0.60, 0.34).y);
await sleep(300);
const t0 = await last();
let hs = await handlesRel();
console.log("TREND_HANDLES " + JSON.stringify(hs));
// hover feedback
const hh = abs(hs[1]);
await mouse("mouseMoved", hh.x, hh.y); await sleep(200);
console.log("HOVER_CURSOR " + await ev("document.querySelector('.chart-host').style.cursor"));
console.log("HOVER_ACTIVE " + await ev("document.querySelectorAll('.draw-layer .draw-item.selected .draw-handle.active').length"));
// endpoint drag
await drag(hh.x, hh.y, hh.x - 220, hh.y - 120);
const t1 = await last();
console.log("TREND_DRAG " + JSON.stringify({ p0same: eq(t0.points[0], t1.points[0]), p1moved: !eq(t0.points[1], t1.points[1]), before: t0.points, after: t1.points }));
await shot("edit-trend.png");

// body drag (o'rtasidan ushlash)
hs = await handlesRel();
const mid = abs({ x: (hs[0].x + hs[1].x) / 2, y: (hs[0].y + hs[1].y) / 2 });
await drag(mid.x, mid.y, mid.x + 60, mid.y + 40);
const t2 = await last();
const d0 = { dt: t2.points[0].time - t1.points[0].time, dp: +(t2.points[0].price - t1.points[0].price).toFixed(7) };
const d1 = { dt: t2.points[1].time - t1.points[1].time, dp: +(t2.points[1].price - t1.points[1].price).toFixed(7) };
console.log("TREND_BODY_DRAG " + JSON.stringify({ sameDelta: d0.dt === d1.dt && Math.abs(d0.dp - d1.dp) < 1e-9, d0, d1 }));

// ------------------------------------------------------------ 2. rect burchagi
console.log("TOOL_RECT " + await toolBtn("rect"));
await sleep(150);
await clickAt(P(0.34, 0.36).x, P(0.34, 0.36).y);
await clickAt(P(0.52, 0.52).x, P(0.52, 0.52).y);
await sleep(250);
const r0 = await last();
hs = await handlesRel();
await drag(abs(hs[1]).x, abs(hs[1]).y, abs(hs[1]).x + 110, abs(hs[1]).y + 70);
const r1 = await last();
console.log("RECT_DRAG " + JSON.stringify({ p0same: eq(r0.points[0], r1.points[0]), p1moved: !eq(r0.points[1], r1.points[1]), before: r0.points, after: r1.points }));
await shot("edit-rect.png");

// ------------------------------------------------------------ 3. hline (vertikal sudrash)
console.log("TOOL_HLINE " + await toolBtn("hline"));
await sleep(150);
await clickAt(P(0.45, 0.5).x, P(0.45, 0.5).y);
await sleep(250);
const h0 = await last();
hs = await handlesRel();
await drag(abs(hs[0]).x, abs(hs[0]).y, abs(hs[0]).x, abs(hs[0]).y - 90);
const h1 = await last();
console.log("HLINE_DRAG " + JSON.stringify({ before: h0.points[0].price, after: h1.points[0].price, moved: Math.abs(h1.points[0].price - h0.points[0].price) > 1e-6 }));

// ------------------------------------------------------------ 4. channel (3-nuqta)
console.log("TOOL_CHANNEL " + await toolBtn("channel"));
await sleep(150);
await clickAt(P(0.26, 0.4).x, P(0.26, 0.4).y);
await clickAt(P(0.42, 0.28).x, P(0.42, 0.28).y);
await clickAt(P(0.34, 0.6).x, P(0.34, 0.6).y);
await sleep(250);
const c0 = await last();
hs = await handlesRel();
await drag(abs(hs[2]).x, abs(hs[2]).y, abs(hs[2]).x + 90, abs(hs[2]).y - 60);
const c1 = await last();
console.log("CHANNEL_DRAG " + JSON.stringify({ p0same: eq(c0.points[0], c1.points[0]), p1same: eq(c0.points[1], c1.points[1]), p2moved: !eq(c0.points[2], c1.points[2]) }));

// ------------------------------------------------------------ 5. long (1 bosish -> avtomatik 1:1)
console.log("TOOL_LONG " + await toolBtn("long"));
await sleep(150);
await clickAt(P(0.30, 0.52).x, P(0.30, 0.52).y);
await sleep(300);
const l0 = await last();
const lgeo = { reward: Math.abs(l0.points[1].price - l0.points[0].price), risk: Math.abs(l0.points[0].price - l0.points[2].price) };
console.log("LONG_AUTO " + JSON.stringify({ points: l0.points.length, rr: +(lgeo.reward / lgeo.risk).toFixed(2), targetAbove: l0.points[1].price > l0.points[0].price, stopBelow: l0.points[2].price < l0.points[0].price }));
hs = await handlesRel();
const longTp = await ev("(()=>{const el=document.querySelector('.draw-item.selected [data-role=\"target\"]');if(!el)return null;return {x:+el.getAttribute('x')+4,y:+el.getAttribute('y')+4};})()");
await drag(abs(longTp).x, abs(longTp).y, abs(longTp).x, abs(longTp).y - 60);
const l1 = await last();
console.log("LONG_DRAG " + JSON.stringify({ p0same: eq(l0.points[0], l1.points[0]), p2same: eq(l0.points[2], l1.points[2]), p1moved: !eq(l0.points[1], l1.points[1]) }));

// ------------------------------------------------------------ 6. polyline o'rta nuqtasi
console.log("TOOL_POLY " + await toolBtn("polyline"));
await sleep(150);
await clickAt(P(0.24, 0.42).x, P(0.24, 0.42).y);
await clickAt(P(0.32, 0.58).x, P(0.32, 0.58).y);
await clickAt(P(0.40, 0.46).x, P(0.40, 0.46).y);
await ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));1");
await sleep(300);
const pl0 = await last();
hs = await handlesRel();
console.log("POLY_HANDLES " + JSON.stringify(hs && hs.length));
await drag(abs(hs[1]).x, abs(hs[1]).y, abs(hs[1]).x + 70, abs(hs[1]).y + 55);
const pl1 = await last();
console.log("POLY_DRAG " + JSON.stringify({ p0same: eq(pl0.points[0], pl1.points[0]), p1moved: !eq(pl0.points[1], pl1.points[1]), p2same: eq(pl0.points[2], pl1.points[2]) }));

// ------------------------------------------------------------ 7. text sudrash
console.log("TOOL_TEXT " + await toolBtn("text"));
await sleep(150);
await clickAt(P(0.6, 0.3).x, P(0.6, 0.3).y);
await sleep(800);
const tx0 = await last();
hs = await handlesRel();
await drag(abs(hs[0]).x, abs(hs[0]).y, abs(hs[0]).x - 100, abs(hs[0]).y - 80);
const tx1 = await last();
console.log("TEXT_DRAG " + JSON.stringify({ moved: !eq(tx0.points[0], tx1.points[0]), before: tx0.points, after: tx1.points }));

// ------------------------------------------------------------ 8. doimiy saqlanish
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2500);
console.log("RELOAD_ITEMS " + await ev("document.querySelectorAll('.draw-layer .draw-item').length"));
console.log("RELOAD_COUNT " + await ev("(JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[]).length"));
await shot("edit-final.png");

console.log("ERRORS " + JSON.stringify(errors.slice(0, 8)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
