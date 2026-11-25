
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 10720 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgeprobe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "about:blank"], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 80; i++) { try { const l = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); page = l.find((t) => t.type === "page"); if (page) break; } catch (e) {} await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const logs = [];
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
await new Promise((r) => { ws.onopen = () => r(null); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  if (m.method === "Runtime.consoleAPICalled") { const text = (m.params.args || []).map((a) => a.value || a.description || "").join(" "); if (text) logs.push(m.params.type.toUpperCase() + " " + text.slice(0, 500)); }
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await ev("localStorage.removeItem('fx.drawings.v1');1");
await send("Page.navigate", { url: "http://127.0.0.1:5173" });
await sleep(6000);
console.log("READY " + await ev("document.documentElement.dataset.chartReady || 'no'"));
console.log("CHART " + await ev("window.__chart ? 'yes' : 'no'"));
console.log("DRAWLAYER " + await ev("document.querySelectorAll('.draw-layer').length"));
console.log("DRAWITEMS " + await ev("document.querySelectorAll('.draw-item').length"));
// create a long via store to check render path
console.log("LOGS " + JSON.stringify(logs.slice(0, 10)));
try { await send("Browser.close"); } catch (e) {}
ws.close(); child.kill(); process.exit(0);
