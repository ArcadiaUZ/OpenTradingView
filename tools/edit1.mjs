
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe";
const port = 10420 + Math.floor(Math.random() * 60);
const profile = mkdtempSync(path.join(tmpdir(), "edgeedit-"));
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
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true, promptText: "T" }).catch(() => {});
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync("D:\\\\Project\\\\New folder\\\\tools\\\\" + name, Buffer.from(s.data, "base64")); };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
const clickAt = async (x, y) => { await mouse("mouseMoved", x, y); await sleep(40); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(40); await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(150); };
const toolBtn = (t) => ev("(()=>{const el=document.querySelector(" + JSON.stringify(".draw-tool-btn[data-tool=" + t + "]") + ");if(!el)return 'missing';el.click();return 'ok';})()");
const store = () => ev("(()=>{try{const d=JSON.parse(localStorage.getItem('fx.drawings.v1')||'{}').drawings||[];return d.map(x=>({t:x.type,p:x.points}));}catch(e){return 'ERR '+e.message;}})()");
const handles = () => ev("(()=>[...document.querySelectorAll('.draw-layer .draw-item.selected .draw-handle')].map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy')})))()");
const geom = () => ev("(()=>{const g=document.querySelector('.draw-layer .draw-item.selected');if(!g)return null;return {type:g.dataset.type,lines:[...g.querySelectorAll('line')].map(l=>[+l.getAttribute('x1'),+l.getAttribute('y1'),+l.getAttribute('x2'),+l.getAttribute('y2')])};})()");

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3500);
// toza holat
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.reload", { ignoreCache: true });
await sleep(1500);
for (let i = 0; i < 140; i++) { if (await ev("document.documentElement.dataset.chartReady==='1'?1:0") === 1) break; await sleep(250); }
await sleep(3000);

const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
console.log("HOST " + JSON.stringify(host));
const P = (fx, fy) => ({ x: Math.round(host.x + host.w * fx), y: Math.round(host.y + host.h * fy) });

// 1) trendline chizish
console.log("TOOL " + await toolBtn("trendline"));
await sleep(200);
const a = P(0.30, 0.62), b = P(0.62, 0.34);
await clickAt(a.x, a.y);
await mouse("mouseMoved", b.x, b.y); await sleep(120);
await clickAt(b.x, b.y);
await sleep(400);
console.log("DRAWN " + JSON.stringify(await store()));
console.log("SEL_GEOM " + JSON.stringify(await geom()));
console.log("HANDLES " + JSON.stringify(await handles()));
await shot("edit-before.png");

// 2) oxirgi nuqtani sudrash (burchakni o'zgartirish)
let hs = await handles();
if (hs && hs.length >= 2) {
  const h = hs[hs.length - 1];
  const hx = Math.round(host.x + h.x), hy = Math.round(host.y + h.y);
  await mouse("mouseMoved", hx, hy); await sleep(80);
  await mouse("mousePressed", hx, hy, { buttons: 1 }); await sleep(80);
  await mouse("mouseMoved", hx - 120, hy - 90, { buttons: 1 }); await sleep(80);
  await mouse("mouseMoved", hx - 240, hy - 150, { buttons: 1 }); await sleep(80);
  await mouse("mouseReleased", hx - 240, hy - 150, { buttons: 0 }); await sleep(300);
  console.log("AFTER_ENDPOINT_DRAG " + JSON.stringify(await store()));
  console.log("SEL_GEOM2 " + JSON.stringify(await geom()));
} else {
  console.log("AFTER_ENDPOINT_DRAG NO_HANDLES " + JSON.stringify(hs));
}
await shot("edit-after-endpoint.png");

// 3) tanlanmagan holatda ham burchakni ushlash (qayta tanlash yo'li)
await ev("document.querySelector('.chart-host').click?.();1");
await sleep(100);
const c = P(0.9, 0.9);
await clickAt(c.x, c.y); // bo'sh joyga bosish -> deselect
await sleep(150);
hs = await handles();
console.log("DESELECTED_HANDLES " + JSON.stringify(hs));
const dg = await geom();
console.log("DESELECTED_GEOM " + JSON.stringify(dg));

console.log("ERRORS " + JSON.stringify(errors.slice(0, 8)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
