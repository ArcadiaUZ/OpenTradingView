import type { Bar } from "./types";
import type { Drawing, DrawPoint, DrawStyle } from "./drawings";
import { fmtMoney, fmtPips, type PositionInfo } from "./positionTool";

/** Ekran koordinatalari (chart konteyneriga nisbatan piksellar). */
export type XY = { x: number; y: number };

export type Viewport = {
  /** UTC sekund -> x piksel (ma'lumot chetidan tashqarida ham ekstrapolyatsiya qiladi). */
  timeToX: (time: number) => number;
  /** Narx -> y piksel. */
  priceToY: (price: number) => number;
  width: number;
  height: number;
  barSpacing: number;
};

export type Prim =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "poly"; points: XY[] }
  | { kind: "label"; x: number; y: number; text: string; anchor: "start" | "middle" | "end"; baseline: "top" | "middle" | "bottom" }
  /** TradingView'dagi kabi rangli yorliq (fon + oq matn). */
  | { kind: "pill"; x: number; y: number; w: number; h: number; text: string; bg: string; color: string };

export type Shape = { points: XY[]; prims: Prim[] };

export function dashFor(style: DrawStyle): string | undefined {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "1 3";
  return undefined;
}

function extendLine(p0: XY, p1: XY, width: number, height: number): XY {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  if (Math.abs(dx) < 0.0001) {
    // Deyarli vertikal: pastga/yuqoriga cho'ziladi.
    return { x: p0.x, y: dy >= 0 ? height : 0 };
  }
  const k = (dy / dx) * (dx >= 0 ? width - p1.x : p1.x - 0) + p1.y;
  return { x: dx >= 0 ? width : 0, y: k };
}

/** Yorliq (pill) matni uchun taxminiy kenglik — SVG matn bilan bir xil shrift. */
export function pillWidth(text: string): number {
  return Math.round(text.length * 5.75 + 12);
}

/** Chizmani ekran primitivlariga aylantiradi (render va hit-test uchun bir manba). */
export function resolveDrawing(drawing: Drawing, viewport: Viewport, info: PositionInfo | null = null, showLabels = true): Shape {
  const vp = viewport;
  const points = drawing.points.map((point) => ({ x: vp.timeToX(point.time), y: vp.priceToY(point.price) }));
  const prims: Prim[] = [];
  const p0 = points[0];
  const p1 = points.length > 1 ? points[1] : points[0];
  const p2 = points.length > 2 ? points[2] : null;

  if (!p0) return { points, prims };

  switch (drawing.type) {
    case "trendline":
      prims.push({ kind: "line", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      break;

    case "ray": {
      const end = extendLine(p0, p1, vp.width, vp.height);
      prims.push({ kind: "line", x1: p0.x, y1: p0.y, x2: end.x, y2: end.y });
      break;
    }

    case "hline":
      prims.push({ kind: "line", x1: 0, y1: p0.y, x2: vp.width, y2: p0.y });
      prims.push({
        kind: "label",
        x: vp.width - 6,
        y: p0.y,
        text: fmtCoordPrice(drawing.points[0].price),
        anchor: "end",
        baseline: "middle",
      });
      break;

    case "vline":
      prims.push({ kind: "line", x1: p0.x, y1: 0, x2: p0.x, y2: vp.height });
      break;

    case "rect": {
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      prims.push({ kind: "rect", x, y, w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) });
      break;
    }

    case "channel": {
      const anchor = p2 || p1;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const a = anchor;
      const b = { x: anchor.x + dx, y: anchor.y + dy };
      prims.push({ kind: "line", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      prims.push({ kind: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      if (drawing.fill) prims.push({ kind: "poly", points: [p0, p1, b, a] });
      break;
    }

    case "arrow": {
      prims.push({ kind: "line", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const size = 10;
      const wing = 0.42;
      prims.push({
        kind: "line",
        x1: p1.x,
        y1: p1.y,
        x2: p1.x - size * Math.cos(angle - wing),
        y2: p1.y - size * Math.sin(angle - wing),
      });
      prims.push({
        kind: "line",
        x1: p1.x,
        y1: p1.y,
        x2: p1.x - size * Math.cos(angle + wing),
        y2: p1.y - size * Math.sin(angle + wing),
      });
      break;
    }

    case "brush":
    case "polyline": {
      for (let index = 1; index < points.length; index += 1) {
        prims.push({ kind: "line", x1: points[index - 1].x, y1: points[index - 1].y, x2: points[index].x, y2: points[index].y });
      }
      break;
    }

    case "text":
      prims.push({
        kind: "label",
        x: p0.x,
        y: p0.y,
        text: drawing.text || "Matn",
        anchor: "start",
        baseline: "bottom",
      });
      break;

    case "long":
    case "short": {
      // TradingView'dagi "Long/Short position" asbobi: kirish chizig'i + TP (yashil)
      // va SL (qizil) zonalari + pip/%/R/R/lot/PnL yorliqlari.
      const target = p1;
      const stop = p2 || p1;
      const left = p0.x;
      const right = Math.max(left + 18, target.x, stop.x);
      const w = Math.max(right - left, 18);
      const top = Math.min(p0.y, target.y);
      const bottom = Math.max(p0.y, stop.y);
      prims.push({ kind: "rect", x: left, y: Math.min(p0.y, target.y), w, h: Math.abs(target.y - p0.y) });
      prims.push({ kind: "rect", x: left, y: Math.min(p0.y, stop.y), w, h: Math.abs(stop.y - p0.y) });
      prims.push({ kind: "line", x1: left, y1: p0.y, x2: left + w, y2: p0.y });
      if (!showLabels) {
        // Ma'lumot faqat hover/tanlangan holatda ko'rinadi (TradingView kabi).
        break;
      }
      if (info) {
        const priceText = (value: number) => fmtCoordPriceDigits(value, info.digits);
        const rrText = (info.rr > 0 ? info.rr.toFixed(2) : "0.00");
        const rewardLine =
          "Target: " + priceText(info.target) + " · " + fmtPips(info.rewardPips) + " pip (" + info.rewardPct.toFixed(2) + "%) · " + rrText + "R · " + fmtMoney(info.targetAmount);
        const stopLine =
          "Stop: " + priceText(info.stop) + " · " + fmtPips(info.riskPips) + " pip (" + info.riskPct.toFixed(2) + "%) · 1.00R · " + fmtMoney(info.stopAmount);
        const pnlText = info.openPnl === null ? "PnL —" : "Open PnL " + fmtMoney(info.openPnl);
        const entryLine =
          "Entry: " + priceText(info.entry) + " · R/R 1:" + rrText + " · Qty " + info.lots.toFixed(2) + " lot · " + pnlText;
        const pillX = (text: string) => Math.max(2, Math.min(left + 2, vp.width - pillWidth(text) - 4));
        const rewardWidth = pillWidth(rewardLine);
        const stopWidth = pillWidth(stopLine);
        const entryWidth = pillWidth(entryLine);
        // Yorliqlar zona tashqarisida turadi (TradingView kabi): target o'z chizig'ining
        // narigi tomonida, stop ham o'z chizig'ining narigi tomonida (long/short uchun simmetrik).
        const targetAboveEntry = target.y <= p0.y;
        const stopBelowEntry = stop.y >= p0.y;
        const rewardPillY = targetAboveEntry
          ? Math.max(2, target.y - 19)
          : Math.min(Math.max(2, target.y + 3), vp.height - 18);
        const stopPillY = stopBelowEntry
          ? Math.min(Math.max(2, stop.y + 3), vp.height - 18)
          : Math.max(2, stop.y - 19);
        prims.push({
          kind: "pill",
          x: pillX(rewardLine),
          y: rewardPillY,
          w: rewardWidth,
          h: 16,
          text: rewardLine,
          bg: "#089981",
          color: "#ffffff",
        });
        prims.push({
          kind: "pill",
          x: pillX(stopLine),
          y: stopPillY,
          w: stopWidth,
          h: 16,
          text: stopLine,
          bg: "#f23645",
          color: "#ffffff",
        });
        prims.push({
          kind: "pill",
          x: pillX(entryLine),
          y: Math.min(Math.max(2, p0.y + 20), vp.height - 18),
          w: entryWidth,
          h: 16,
          text: entryLine,
          bg: info.openPnl !== null && info.openPnl < 0 ? "#f23645" : "#089981",
          color: "#ffffff",
        });
      } else {
        prims.push({ kind: "label", x: left + w + 6, y: p0.y, text: "kirish", anchor: "start", baseline: "middle" });
        prims.push({ kind: "label", x: left + w + 6, y: target.y, text: "TP", anchor: "start", baseline: "middle" });
        prims.push({ kind: "label", x: left + w + 6, y: stop.y, text: "SL", anchor: "start", baseline: "middle" });
      }
      break;
    }

    default:
      break;
  }

  return { points, prims };
}

function fmtCoordPriceDigits(price: number, digits: number): string {
  const d = Math.min(8, Math.max(0, Math.round(digits)));
  if (!Number.isFinite(price)) return "-";
  return price.toFixed(d);
}

function fmtCoordPrice(price: number): string {
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 10) return price.toFixed(3);
  return price.toFixed(5);
}

// ------------------------------------------------------------------ hit-test

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export type Hit = { drawing: Drawing; part: "point" | "body"; index: number };

/**
 * Ekran nuqtasiga eng yaqin chizma. Tepadan pastga qarab tekshiradi
 * (oxirgi chizilgan — eng ustda). Nuqta tutqichlari tanlangan chizma uchun ustuvor.
 */
export function hitTest(drawings: Drawing[], viewport: Viewport, x: number, y: number, radius = 6, preferId: string | null = null): Hit | null {
  // Tanlangan chizmaning tutqichlari kengroq radiusda ushlanadi (TradingView kabi):
  // foydalanuvchi chiziqni tanlab, uning uchini oson sudrab uzaytira oladi.
  if (preferId) {
    const preferred = drawings.find((item) => item.id === preferId);
    if (preferred) {
      const shape = resolveDrawing(preferred, viewport);
      for (let p = 0; p < shape.points.length; p += 1) {
        const point = shape.points[p];
        if (Math.hypot(point.x - x, point.y - y) <= radius + 5) {
          return { drawing: preferred, part: "point", index: p };
        }
      }
    }
  }
  for (let index = drawings.length - 1; index >= 0; index -= 1) {
    const drawing = drawings[index];
    const shape = resolveDrawing(drawing, viewport);

    for (let p = 0; p < shape.points.length; p += 1) {
      const point = shape.points[p];
      if (Math.hypot(point.x - x, point.y - y) <= radius + 1) {
        return { drawing, part: "point", index: p };
      }
    }

    for (const prim of shape.prims) {
      if (prim.kind === "line") {
        if (distToSegment(x, y, prim.x1, prim.y1, prim.x2, prim.y2) <= radius) return { drawing, part: "body", index: -1 };
      } else if (prim.kind === "rect") {
        if (prim.w < 2 && prim.h < 2) {
          if (Math.hypot(x - prim.x, y - prim.y) <= radius) return { drawing, part: "body", index: -1 };
          continue;
        }
        const inside = x >= prim.x - radius && x <= prim.x + prim.w + radius && y >= prim.y - radius && y <= prim.y + prim.h + radius;
        if (!inside) continue;
        const nearEdge =
          x <= prim.x + radius ||
          x >= prim.x + prim.w - radius ||
          y <= prim.y + radius ||
          y >= prim.y + prim.h - radius;
        if (nearEdge || drawing.fill || drawing.type === "long" || drawing.type === "short") {
          return { drawing, part: "body", index: -1 };
        }
      } else if (prim.kind === "poly") {
        for (let p = 1; p < prim.points.length; p += 1) {
          const a = prim.points[p - 1];
          const b = prim.points[p];
          if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= radius + 2) return { drawing, part: "body", index: -1 };
        }
      } else if (prim.kind === "label") {
        const width = prim.text.length * 6.4 + 8;
        const left = prim.anchor === "end" ? prim.x - width : prim.anchor === "middle" ? prim.x - width / 2 : prim.x;
        const top = prim.baseline === "top" ? prim.y : prim.baseline === "middle" ? prim.y - 8 : prim.y - 14;
        if (x >= left && x <= left + width && y >= top && y <= top + 16) return { drawing, part: "body", index: -1 };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ measure

export type MeasureStats = {
  deltaPrice: number;
  pips: number;
  pct: number;
  bars: number;
  seconds: number;
  up: boolean;
  from: number;
  to: number;
};

export function measureStats(
  p1: DrawPoint,
  p2: DrawPoint,
  bars: Bar[],
  tfSec: number,
  point: number
): MeasureStats {
  const deltaPrice = p2.price - p1.price;
  const pips = Math.abs(deltaPrice) / (point * 10);
  const pct = p1.price ? (deltaPrice / p1.price) * 100 : 0;
  const seconds = Math.abs(p2.time - p1.time);
  let barCount = Math.round(seconds / tfSec);
  if (bars.length) {
    const index = (time: number) => {
      let lo = 0;
      let hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const i1 = index(p1.time);
    const i2 = index(p2.time);
    barCount = Math.abs(i2 - i1);
  }
  return {
    deltaPrice,
    pips,
    pct,
    bars: barCount,
    seconds,
    up: deltaPrice >= 0,
    from: p1.price,
    to: p2.price,
  };
}

export function fmtDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return days + " kun " + hours + " soat";
  if (hours > 0) return hours + " soat " + minutes + " daq";
  if (minutes > 0) return minutes + " daq";
  return seconds + " s";
}

// --------------------------------------------------------------- viewport

export type ViewportInput = {
  bars: Bar[];
  tfSec: number;
  width: number;
  height: number;
  barSpacing: number;
  logicalToX: (logical: number) => number | null;
  priceToY: (price: number) => number | null;
  priceRange: { from: number; to: number } | null;
  paneHeight: number;
};

/** Chart API'dan mustaqil, sof hisoblanadigan koordinata o'girgichi. */
export function makeViewport(input: ViewportInput): Viewport {
  const { bars, tfSec, width, height, barSpacing, logicalToX, priceToY, priceRange, paneHeight } = input;

  const xOfLogical = (logical: number): number | null => {
    const x = logicalToX(logical);
    return x === null || x === undefined || !isFinite(x) ? null : x;
  };

  const timeToX = (time: number): number => {
    if (!bars.length) return width / 2;
    const first = bars[0].time;
    const last = bars[bars.length - 1].time;
    if (time <= first) {
      const base = xOfLogical(0) ?? width / 2;
      return base + ((time - first) / tfSec) * barSpacing;
    }
    if (time >= last) {
      const base = xOfLogical(bars.length - 1) ?? width / 2;
      return base + ((time - last) / tfSec) * barSpacing;
    }
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    const rightIndex = lo;
    if (bars[rightIndex].time === time) return xOfLogical(rightIndex) ?? width / 2;
    const leftIndex = Math.max(0, rightIndex - 1);
    const t0 = bars[leftIndex].time;
    const t1 = bars[rightIndex].time;
    const x0 = xOfLogical(leftIndex);
    const x1 = xOfLogical(rightIndex);
    if (x0 !== null && x1 !== null && t1 > t0) {
      return x0 + ((time - t0) / (t1 - t0)) * (x1 - x0);
    }
    return xOfLogical(leftIndex) ?? width / 2;
  };

  const priceToYFn = (price: number): number => {
    const y = priceToY(price);
    if (y !== null && y !== undefined && isFinite(y)) return y;
    if (priceRange && priceRange.to !== priceRange.from) {
      return ((priceRange.to - price) / (priceRange.to - priceRange.from)) * paneHeight;
    }
    return paneHeight / 2;
  };

  return { timeToX, priceToY: priceToYFn, width, height, barSpacing };
}
