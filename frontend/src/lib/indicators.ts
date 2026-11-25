import type { Bar } from "./types";
import type { UTCTimestamp } from "lightweight-charts";

export type Point = { time: UTCTimestamp; value: number };

export function sma(bars: Bar[], period: number): Point[] {
  const out: Point[] = [];
  if (bars.length < period) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time as UTCTimestamp, value: sum / period });
  }
  return out;
}

export function ema(bars: Bar[], period: number): Point[] {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  const out: Point[] = [];
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += bars[i].close;
  let value = seed / period;
  out.push({ time: bars[period - 1].time as UTCTimestamp, value });
  for (let i = period; i < bars.length; i += 1) {
    value = bars[i].close * k + value * (1 - k);
    out.push({ time: bars[i].time as UTCTimestamp, value });
  }
  return out;
}

export function bollinger(bars: Bar[], period = 20, mult = 2) {
  const mid: Point[] = [];
  const upper: Point[] = [];
  const lower: Point[] = [];
  if (bars.length < period) return { mid, upper, lower };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const close = bars[i].close;
    sum += close;
    sumSq += close * close;
    if (i >= period) {
      const old = bars[i - period].close;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(0, sumSq / period - mean * mean);
      const dev = Math.sqrt(variance) * mult;
      const time = bars[i].time as UTCTimestamp;
      mid.push({ time, value: mean });
      upper.push({ time, value: mean + dev });
      lower.push({ time, value: mean - dev });
    }
  }
  return { mid, upper, lower };
}
