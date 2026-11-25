import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] || "http://127.0.0.1:5173";
const outFile = process.argv[3] || "D:\\Project\\New folder\\shot.png";
const waitMs = Number(process.argv[4] || 7000);
const port = 9333 + Math.floor(Math.random() * 40);
const profile = mkdtempSync(path.join(tmpdir(), "edgeshot-"));

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--window-size=1920,872", "--remote-debugging-port=" + port,
  "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch("http://127.0.0.1:" + port + "/json/list");
  return res.json();
}

async function main() {
  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await targets();
      page = list.find((t) => t.type === "page");
      if (page) break;
    } catch (e) { /* not ready */ }
    await sleep(250);
  }
  if (!page) throw new Error("no page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  const send = (method, params) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  await new Promise((res) => { ws.onopen = () => res(null); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push("console." + msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === "Log.entryAdded") {
      logs.push("log." + msg.params.entry.level + ": " + msg.params.entry.text);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.navigate", { url });
  await sleep(waitMs);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(outFile, Buffer.from(shot.data, "base64"));
  console.log("SAVED " + outFile + " (" + Buffer.from(shot.data, "base64").length + " bytes)");
  console.log("LOGS:\n" + (logs.slice(0, 30).join("\n") || "(none)"));
  try { await send("Browser.close"); } catch (e) { /* noop */ }
  ws.close();
  child.kill();
  process.exit(0);
}

main().catch(async (err) => {
  console.log("FAIL " + err.message);
  try { child.kill(); } catch (e) { /* noop */ }
  process.exit(1);
});
