import { TickMarkType } from "lightweight-charts";
import type { Bar } from "./types";

export const TF_LIST = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1D", "1W"];

export const TF_LABEL: Record<string, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "2h": "2h", "4h": "4h", "1D": "D", "1W": "W",
};

export const TF_SECONDS: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "1D": 86400, "1W": 604800,
};

export function fmtPrice(value: number, digits: number): string {
  if (!isFinite(value)) return "-";
  return value.toFixed(digits);
}

export function fmtPips(diff: number, point: number, digits: number): string {
  const pips = diff / (point * 10);
  const sign = pips > 0 ? "+" : "";
  return sign + pips.toFixed(digits > 3 ? 1 : 2);
}

export function fmtChangePct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(2) + "%";
}

export function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function localHms(ts: number): string {
  const d = new Date(ts * 1000);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

export function utcOffsetLabel(): string {
  const mins = -new Date().getTimezoneOffset();
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return "UTC" + sign + h + (m ? ":" + pad2(m) : "");
}

export function makeTickMarkFormatter() {
  return (time: unknown, type: TickMarkType): string => {
    const d = new Date(Number(time) * 1000);
    switch (type) {
      case TickMarkType.Year:
        return String(d.getFullYear());
      case TickMarkType.Month:
        return d.toLocaleDateString("en-US", { month: "short" });
      case TickMarkType.DayOfMonth:
        return String(d.getDate());
      default:
        return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
  };
}

export function barDirection(bar: Bar | null | undefined): "up" | "down" | "flat" {
  if (!bar) return "flat";
  if (bar.close > bar.open) return "up";
  if (bar.close < bar.open) return "down";
  return "flat";
}
