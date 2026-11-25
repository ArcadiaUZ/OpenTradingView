const base = "http://127.0.0.1:8787";
const fmt = (t) => new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent" });
for (let i = 0; i < 40; i++) { try { const h = await (await fetch(base + "/api/health")).json(); if (h.ready) { console.log("health ok, offset", h.serverOffset); break; } } catch (e) {} await new Promise(r => setTimeout(r, 1000)); }
for (const tf of ["1m", "5m", "15m"]) {
  const r = await (await fetch(base + "/api/history?symbol=EURUSD&tf=" + tf + "&count=300")).json();
  const b = r.bars; const sec = { "1m": 60, "5m": 300, "15m": 900 }[tf];
  let gaps = 0; for (let i = 1; i < b.length; i++) if (b[i].time - b[i-1].time !== sec) gaps++;
  console.log(tf, "bars:", b.length, "gaps:", gaps, "| last:", fmt(b[b.length-1].time), "| age:", Math.floor(Date.now()/1000) - b[b.length-1].time + "s");
}