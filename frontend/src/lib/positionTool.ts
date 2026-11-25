import type { Bar } from "./types";
import type { Drawing, DrawPoint } from "./drawings";
import { positionPnl } from "./paper";
import type { Viewport } from "./drawGeometry";

/**
 * Long/Short pozitsiya asbobi matematikasi — TradingView'dagi "Long Position"
 * asbobi kabi: kirish nuqtasi bosilganda TP/SL avtomatik 1:1 qo'yiladi, keyin
 * foydalanuvchi ularni tortib to'g'irlaydi. Label'larda pip, %, R/R, lot va
 * potensial foyda/zarar ($) ko'rsatiladi.
 */

export type PositionSide = "long" | "short";

export type PositionInfo = {
  side: PositionSide;
  entry: number;
  target: number;
  stop: number;
  rewardPips: number;
  riskPips: number;
  rewardPct: number;
  riskPct: number;
  /** reward / risk */
  rr: number;
  lots: number;
  targetAmount: number;
  stopAmount: number;
  /** Joriy narx bo'yicha ochiq PnL ($). */
  openPnl: number | null;
  price: number | null;
  digits: number;
};

export type PositionRole = "entry" | "target" | "stop" | "width";

export type PositionHandle = { x: number; y: number; role: PositionRole };

/** Avtomatik quti kengligi (shamlarda). */
const DEFAULT_WIDTH_BARS = 40;

export function positionSide(drawing: Drawing): PositionSide | null {
  if (drawing.type === "long") return "long";
  if (drawing.type === "short") return "short";
  return null;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Oxirgi shamlar volatilligidan 1:1 TP/SL masofasini tanlaydi (chartda ko'rinadigan quti). */
export function defaultRiskDistance(price: number, bars: Bar[]): number {
  let sum = 0;
  let count = 0;
  for (let index = Math.max(0, bars.length - 60); index < bars.length; index += 1) {
    const bar = bars[index];
    const range = finite(Number(bar.high)) - finite(Number(bar.low));
    if (range > 0) {
      sum += range;
      count += 1;
    }
  }
  const avg = count ? sum / count : price * 0.001;
  const raw = avg * 6;
  const min = price * 0.0004;
  const max = price * 0.003;
  const distance = Math.min(max, Math.max(min, raw));
  return distance > 0 ? distance : price * 0.001;
}

/** Birinchi bosishda tayyor 3 nuqta: kirish, TP (1R), SL (1R). */
export function autoPositionPoints(input: {
  side: PositionSide;
  entry: DrawPoint;
  bars: Bar[];
  tfSec: number;
}): DrawPoint[] {
  const step = input.tfSec > 0 ? input.tfSec : 60;
  const risk = defaultRiskDistance(input.entry.price, input.bars);
  const dir = input.side === "long" ? 1 : -1;
  const rightTime = Math.round((input.entry.time + DEFAULT_WIDTH_BARS * step) / step) * step;
  return [
    { time: input.entry.time, price: input.entry.price },
    { time: rightTime, price: input.entry.price + dir * risk },
    { time: rightTime, price: input.entry.price - dir * risk },
  ];
}

/** Ekranda ko'rsatiladigan tutqichlar: TP/SL burchaklari + kirish chizig'i + kenglik. */
export function positionHandles(drawing: Drawing, viewport: Viewport): PositionHandle[] {
  if (!positionSide(drawing)) return [];
  const entry = drawing.points[0];
  const target = drawing.points[1];
  const stop = drawing.points[2];
  if (!entry || !target || !stop) return [];
  const left = viewport.timeToX(entry.time);
  const right = Math.max(viewport.timeToX(target.time), viewport.timeToX(stop.time));
  return [
    { x: left, y: viewport.priceToY(target.price), role: "target" },
    { x: left, y: viewport.priceToY(stop.price), role: "stop" },
    { x: left, y: viewport.priceToY(entry.price), role: "entry" },
    { x: Math.max(right, left + 18), y: viewport.priceToY(entry.price), role: "width" },
  ];
}

function pipsOf(distance: number, digits: number): number {
  const point = Math.pow(10, -Math.max(0, digits));
  const pip = point * 10;
  return pip > 0 ? Math.abs(distance) / pip : Math.abs(distance);
}

/** Long/Short chizmasi uchun R/R, pip, lot va $ hisoblari. */
export function computePositionInfo(
  drawing: Drawing,
  opts: { price: number | null; lots: number; digits: number }
): PositionInfo | null {
  const side = positionSide(drawing);
  if (!side) return null;
  const entryPoint = drawing.points[0];
  const targetPoint = drawing.points[1];
  const stopPoint = drawing.points[2];
  if (!entryPoint || !targetPoint || !stopPoint) return null;
  const entry = finite(entryPoint.price);
  const target = finite(targetPoint.price);
  const stop = finite(stopPoint.price);
  if (entry <= 0 || target <= 0 || stop <= 0) return null;
  const digits = Math.min(8, Math.max(0, Math.round(opts.digits)));
  const lots = Math.min(100, Math.max(0.01, finite(opts.lots, 0.1)));
  const riskDistance = Math.abs(entry - stop);
  const rewardDistance = Math.abs(target - entry);
  const rr = riskDistance > 0 ? rewardDistance / riskDistance : 0;
  const position = {
    id: "tool",
    symbol: drawing.symbol,
    side: (side === "long" ? "buy" : "sell") as "buy" | "sell",
    lots,
    entry,
    sl: null as number | null,
    tp: null as number | null,
    opened: 0,
    digits,
  };
  const amountAt = (value: number) => finite(positionPnl(position, value));
  const price = opts.price !== null && Number.isFinite(opts.price) && opts.price > 0 ? opts.price : null;
  return {
    side,
    entry,
    target,
    stop,
    rewardPips: pipsOf(rewardDistance, digits),
    riskPips: pipsOf(riskDistance, digits),
    rewardPct: entry > 0 ? (rewardDistance / entry) * 100 : 0,
    riskPct: entry > 0 ? (riskDistance / entry) * 100 : 0,
    rr,
    lots,
    targetAmount: amountAt(target),
    stopAmount: amountAt(stop),
    openPnl: price === null ? null : amountAt(price),
    price,
    digits,
  };
}

/* ------------------------------------------------------------- formatlash */

export function fmtPips(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return abs.toFixed(0);
  if (abs >= 10) return abs.toFixed(1);
  return abs.toFixed(1);
}

export function fmtMoney(value: number): string {
  const abs = Math.abs(value);
  const body = abs >= 1000 ? abs.toFixed(0) : abs.toFixed(2);
  return (value < 0 ? "-$" : "+$") + body;
}
