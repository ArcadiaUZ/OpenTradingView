const base = "http://127.0.0.1:8787";
const r = await (await fetch(base + "/api/history?symbol=EURUSD&tf=1m&count=1200")).json();
const bars = r.bars;
const fmt = (t) => new Date(t * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Tashkent" });
console.log("bars:", bars.length, "from", fmt(bars[0].time), "to", fmt(bars[bars.length-1].time));
// missing minute gaps
const gaps = [];
for (let i = 1; i < bars.length; i++) { const d = bars[i].time - bars[i-1].time; if (d > 60) gaps.push({ at: fmt(bars[i-1].time), next: fmt(bars[i].time), minutes: d / 60 }); }
console.log("\nGAPS (>1 min):", gaps.length);
gaps.slice(-15).forEach(g => console.log("  after", g.at, "->", g.next, "=", g.minutes, "min"));
const ranges = bars.map(b => (b.high - b.low) * 100000);
const sorted = ranges.slice().sort((a,b) => a-b);
const median = sorted[Math.floor(sorted.length/2)];
console.log("\nmedian 1m range (points):", median.toFixed(1), "max:", sorted[sorted.length-1].toFixed(1));
const outliers = bars.map((b, i) => ({ i, t: fmt(b.time), range: ranges[i], o: b.open, h: b.high, l: b.low, c: b.close })).filter(x => x.range > Math.max(6, median * 5));
console.log("OUTLIER bars (range > 5x median):", outliers.length);
outliers.slice(-12).forEach(x => console.log("  ", x.t, "range=" + x.range.toFixed(1), "O" + x.o, "H" + x.h, "L" + x.l, "C" + x.c));
// consecutive-bar price jumps
let jumps = [];
for (let i = 1; i < bars.length; i++) { const d = Math.abs(bars[i].open - bars[i-1].close) * 100000; if (d > 8) jumps.push({ at: fmt(bars[i].time), jump: d.toFixed(1), prevClose: bars[i-1].close, open: bars[i].open }); }
console.log("\nJUMPS between consecutive closes/opens (>0.8 pip):", jumps.length);
jumps.slice(-12).forEach(j => console.log("  ", j.at, "jump", j.jump, "pts", j.prevClose, "->", j.open));