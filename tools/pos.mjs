
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10620 + Math.floor(Math.random() * 60);
const profile = mkdtempSync(path.join(tmpdir(), "edgepos-"));
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
  if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    const text = (m.params.args || []).map((a) => a.value || a.description || "").join(" ");
    if (text) errors.push(text.slice(0, 400));
  }
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "T" }).catch(() => {});
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\Project\\New folder\\tools\\" + name, Buffer.from(s.data, "base64")); };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(200); };
const drag = async (x1, y1, x2, y2, steps = 5) => {
  await mouse("mouseMoved", x1, y1); await sleep(60);
  await mouse("mousePressed", x1, y1, { buttons: 1 }); await sleep(70);
  for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", Math.round(x1 + (x2 - x1) * i / steps), Math.round(y1 + (y2 - y1) * i / steps), { buttons: 1 }); await sleep(55); }
  await mouse("mouseReleased", x2, y2, { buttons: 0 }); await sleep(250);
};
const toolBtn = (t) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-tool-btn[data-tool=" + t + "]") + ");if(!el)return 'missing';el.click();return 'ok';})()");
const store = () => ev("(()=>{const d=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[];return d;})()");
const last = async () => { const all = await store(); return Array.isArray(all) && all.length ? all[all.length - 1] : null; };
const pills = () => ev("(()=>[...document.querySelectorAll('.draw-item.selected .draw-pill-text')].map(t=>t.textContent))()");
const rolePoint = (role) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-item.selected [data-role=" + role + "]") + ");if(!el)return null;if(el.tagName==='rect')return {x:+el.getAttribute('x')+4,y:+el.getAttribute('y')+4};return {x:+el.getAttribute('cx'),y:+el.getAttribute('cy')};})()");
const handleInfo = () => ev("(()=>({sq:document.querySelectorAll('.draw-item.selected rect.draw-handle.sq').length,circles:document.querySelectorAll('.draw-item.selected circle.draw-handle').length}))()");
const rr = (d) => { const e = d.points[0].price, t = d.points[1].price, s = d.points[2].price; return { entry: e, target: t, stop: s, reward: Math.abs(t - e), risk: Math.abs(e - s), rr: Math.abs(t - e) / Math.abs(e - s) }; };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3500);
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3000);

// Narx shkalasini 3x kengaytiramiz: avtomatik 1:1 quti balandligi chartga sig'ishi uchun
// (aks holda TP/SL tutqichlari ko'rinmaydigan joyga tushib qoladi).
console.log("ZOOM_PRICE " + await ev("(()=>{const s=window.__series;const r=s.priceScale().getVisibleRange();if(!r)return 'no-range';const mid=(r.from+r.to)/2;const span=(r.to-r.from)*3;s.priceScale().applyOptions({autoScale:false});s.priceScale().setVisibleRange({from:mid-span/2,to:mid+span/2});return 'ok'})()"));
await sleep(400);

const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });
const abs = (h) => ({ x: Math.round(host.x + h.x), y: Math.round(host.y + h.y) });

// ------------------------------------------------------------------ LONG
console.log("LONG_TOOL " + await toolBtn("long"));
await sleep(150);
await clickAt(P(0.30, 0.5).x, P(0.30, 0.5).y);
await sleep(400);
const l0 = await last();
console.log("LONG_CREATE " + JSON.stringify({ type: l0 && l0.type, points: l0 && l0.points.length, geo: l0 && rr(l0) }));
console.log("LONG_PILLS " + JSON.stringify(await pills()));
console.log("LONG_HANDLES " + JSON.stringify(await handleInfo()));
await shot("pos-long-auto.png");

// TP tutqichini yuqoriga tortish
const tpBtn = abs(await rolePoint("target"));
await mouse("mouseMoved", tpBtn.x, tpBtn.y); await sleep(180);
console.log("HOVER_TP_CURSOR " + await ev("document.querySelector('.chart-host').style.cursor"));
await drag(tpBtn.x, tpBtn.y, tpBtn.x, tpBtn.y - 110);
const l1 = await last();
console.log("LONG_TP_DRAG " + JSON.stringify({ before: rr(l0), after: rr(l1), stopSame: l0.points[2].price === l1.points[2].price }));
console.log("LONG_PILLS_TP " + JSON.stringify(await pills()));

// SL tutqichini pastga tortish
const slBtn = abs(await rolePoint("stop"));
await drag(slBtn.x, slBtn.y, slBtn.x, slBtn.y + 70);
const l2 = await last();
console.log("LONG_SL_DRAG " + JSON.stringify({ before: rr(l1), after: rr(l2), targetSame: l1.points[1].price === l2.points[1].price }));

// kenglik tutqichi
const wBtn = abs(await rolePoint("width"));
await drag(wBtn.x, wBtn.y, wBtn.x + 130, wBtn.y);
const l3 = await last();
console.log("LONG_WIDTH_DRAG " + JSON.stringify({ timeBefore: [l2.points[1].time, l2.points[2].time], timeAfter: [l3.points[1].time, l3.points[2].time], pricesSame: l2.points[1].price === l3.points[1].price && l2.points[2].price === l3.points[2].price }));

// kirish chizig'ini sudrash (butun pozitsiya)
const eBtn = abs(await rolePoint("entry"));
await drag(eBtn.x, eBtn.y, eBtn.x + 40, eBtn.y - 60);
const l4 = await last();
console.log("LONG_ENTRY_DRAG " + JSON.stringify({ allMoved: l4.points.every((p, i) => p.price !== l3.points[i].price), rrSame: +(rr(l4).rr - rr(l3).rr).toFixed(4) }));
await shot("pos-long-edited.png");

// ---------------------------------------------------- yorliqlar faqat hover/tanlashda
const hTarget = abs(await rolePoint("target"));
const hEntry = abs(await rolePoint("entry"));
const hWidth = abs(await rolePoint("width"));
const boxCenter = { x: Math.round((hEntry.x + hWidth.x) / 2), y: Math.round((hEntry.y + hTarget.y) / 2) };
const empty = P(0.86, 0.12);
const pillCount = () => ev("document.querySelectorAll('.draw-pill-text').length");
await clickAt(empty.x, empty.y);           // tanlovni bo'shatish
await mouse("mouseMoved", empty.x, empty.y); await sleep(320);
console.log("LABELS_NO_HOVER " + await pillCount());
await shot("pos-nohover.png");
await mouse("mouseMoved", boxCenter.x, boxCenter.y); await sleep(320);
console.log("LABELS_HOVER " + await pillCount());
await mouse("mouseMoved", empty.x, empty.y); await sleep(320);
console.log("LABELS_HOVER_OUT " + await pillCount());
await clickAt(boxCenter.x, boxCenter.y);   // tanlash
await mouse("mouseMoved", empty.x, empty.y); await sleep(320);
console.log("LABELS_SELECTED " + await pillCount());
await mouse("mouseMoved", boxCenter.x, boxCenter.y); await sleep(320);
await shot("pos-hover.png");
await clickAt(empty.x, empty.y);
await mouse("mouseMoved", empty.x, empty.y); await sleep(320);
console.log("LABELS_AFTER_DESELECT " + await pillCount());

// ------------------------------------------------------------------ SHORT
console.log("SHORT_TOOL " + await toolBtn("short"));
await sleep(150);
await clickAt(P(0.62, 0.4).x, P(0.62, 0.4).y);
await sleep(400);
const s0 = await last();
console.log("SHORT_CREATE " + JSON.stringify({ type: s0 && s0.type, points: s0 && s0.points.length, geo: s0 && rr(s0), targetBelow: s0.points[1].price < s0.points[0].price, stopAbove: s0.points[2].price > s0.points[0].price }));
console.log("SHORT_PILLS " + JSON.stringify(await pills()));
const sTp = abs(await rolePoint("target"));
await drag(sTp.x, sTp.y, sTp.x, sTp.y + 90);
const s1 = await last();
console.log("SHORT_TP_DRAG " + JSON.stringify({ before: rr(s0), after: rr(s1), stopSame: s0.points[2].price === s1.points[2].price }));
const sSl = abs(await rolePoint("stop"));
await drag(sSl.x, sSl.y, sSl.x, sSl.y - 60);
const s2 = await last();
console.log("SHORT_SL_DRAG " + JSON.stringify({ before: rr(s1), after: rr(s2), targetSame: s1.points[1].price === s2.points[1].price }));
await shot("pos-short-auto.png");

// reload persistence
await send("Page.reload", { ignoreCache: true }); await sleep(1200);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(2500);
console.log("RELOAD_COUNT " + await ev("(JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[]).length"));
console.log("RELOAD_PILLS " + await ev("document.querySelectorAll('.draw-pill-text').length"));
console.log("RELOAD_TYPES " + JSON.stringify(await ev("(()=>{const d=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[];return d.map(x=>x.type)})()")));
await shot("pos-reload.png");

console.log("ERRORS " + JSON.stringify(errors.slice(0, 8)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
