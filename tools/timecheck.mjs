const base = "http://127.0.0.1:8787";
const fmt = (t) => new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent" });
for (let i = 0; i < 40; i++) { try { const h = await (await fetch(base + "/api/health")).json(); if (h.ready) { console.log("health ready, offset", h.serverOffset); break; } } catch (e) {} await new Promise(r => setTimeout(r, 1000)); }
const nowSec = Math.floor(Date.now() / 1000);
const r = await (await fetch(base + "/api/history?symbol=EURUSD&tf=1m&count=50")).json();
const last = r.bars[r.bars.length - 1];
console.log("now:", new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent" }), "| last bar:", fmt(last.time), "| delta to now:", nowSec - last.time, "s");
console.log("last 4 bars:", r.bars.slice(-4).map(b => fmt(b.time) + " c=" + b.close).join(" | "));
const ws = new WebSocket("ws://127.0.0.1:8787/ws");
let init = 0, pushes = 0, counts = 0, lastMsg = null, hb = 0;
ws.onopen = () => ws.send(JSON.stringify({ op: "sub", symbol: "EURUSD", tf: "1m", count: 200 }));
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === "init") { init = m.bars.length; lastMsg = m.bars[m.bars.length-1]; } else if (m.type === "bar") { pushes++; counts++; lastMsg = m.bar; } else if (m.type === "bars") { pushes++; lastMsg = m.bars[m.bars.length-1]; } else if (m.type === "heartbeat") hb++; };
await new Promise(res => setTimeout(res, 25000));
console.log("WS: init_bars=" + init + " bar_msgs=" + pushes + " heartbeats=" + hb + " last=" + (lastMsg ? fmt(lastMsg.time) + " c=" + lastMsg.close : "none"));
ws.close();