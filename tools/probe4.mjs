
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10820 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgeprobe4-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 80; i++) { try { const l = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = l.find((t) => t.type === "page"); if (page) break; } catch (e) {} await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errs = [];
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
await new Promise((r) => { ws.onopen = () => r(null); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") {
    const ex = m.params.exceptionDetails.exception || {};
    errs.push({ text: m.params.exceptionDetails.text, desc: ex.description || "", value: ex.value, line: m.params.exceptionDetails.lineNumber, url: m.params.exceptionDetails.url });
  }
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 600) : r.result.value; };
const mouse = (type, x, y, extra) => send("Input.dispatchMouseEvent", Object.assign({ type, x, y, button: "left", clickCount: 1 }, extra || {}));
await send("Page.enable"); await send("Runtime.enable");
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
await sleep(6000);
const host = await ev("(()=>{const r=document.querySelector('.chart-host').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
await ev("(()=>{const el=document.querySelector('.draw-tool-btn[data-tool=\"long\"]');if(el)el.click();return 1;})()");
await sleep(300);
const x = Math.round(host.x + host.w * 0.4), y = Math.round(host.y + host.h * 0.45);
await mouse("mouseMoved", x, y); await sleep(60);
await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(60);
await mouse("mouseReleased", x, y, { buttons: 0 }); await sleep(600);
console.log("ERRS " + JSON.stringify(errs.slice(0, 4)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
