import { MAX_CLIENT_BARS, useTerminal } from "../store";
import { TF_SECONDS } from "./format";
import type { Bar } from "./types";

const DAY = 86400;

export const RANGE_PRESETS = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"];

export function presetSeconds(preset: string): number {
  const now = Math.floor(Date.now() / 1000);
  switch (preset) {
    case "1D": return DAY;
    case "5D": return DAY * 5;
    case "1M": return DAY * 30;
    case "3M": return DAY * 90;
    case "6M": return DAY * 180;
    case "YTD": {
      const start = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
      return Math.max(DAY, now - Math.floor(start));
    }
    case "1Y": return DAY * 365;
    case "5Y": return DAY * 365 * 5;
    default: return 0;
  }
}

async function fetchOlder(symbol: string, tf: string, before: number, count: number): Promise<Bar[]> {
  const url =
    "/api/history?symbol=" + encodeURIComponent(symbol) +
    "&tf=" + encodeURIComponent(tf) +
    "&count=" + count +
    "&before=" + before;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const bars = Array.isArray(json.bars) ? (json.bars as Bar[]) : [];
  return bars.filter((bar) => bar && typeof bar.time === "number" && bar.time < before);
}

/**
 * TradingView-style range buttons: show a fixed period ending at the last candle.
 * Pulls older pages from the backend when the chart does not hold enough history.
 */
export async function applyRange(preset: string): Promise<void> {
  const initial = useTerminal.getState();
  const initialBars = initial.data ? initial.data.bars : [];
  if (!initialBars.length) {
    initial.pushToast("Ma'lumot hali yuklanmadi");
    return;
  }
  if (preset === "All") {
    useTerminal.getState().applyView(0, initialBars.length + 6);
    return;
  }
  const tfSeconds = TF_SECONDS[initial.tf] || 60;
  const seconds = presetSeconds(preset);
  const target = Math.min(MAX_CLIENT_BARS - 200, Math.max(40, Math.round(seconds / tfSeconds)));
  const symbol = initial.symbol;
  const tf = initial.tf;
  useTerminal.getState().setLoadingRange(preset);
  try {
    let pages = 0;
    while (pages < 5) {
      const state = useTerminal.getState();
      if (state.symbol !== symbol || state.tf !== tf) return;
      const bars = state.data ? state.data.bars : [];
      if (!bars.length || bars.length >= target) break;
      const need = Math.min(5000, target - bars.length + 25);
      const older = await fetchOlder(symbol, tf, bars[0].time, need);
      if (!older.length) break;
      useTerminal.getState().prependBars(older);
      pages += 1;
    }
    const state = useTerminal.getState();
    if (state.symbol !== symbol || state.tf !== tf) return;
    const bars = state.data ? state.data.bars : [];
    if (!bars.length) return;
    const visible = Math.min(target, bars.length);
    state.applyView(Math.max(0, bars.length - visible), bars.length + 6);
    if (bars.length < target * 0.85) {
      state.pushToast("Bu davr uchun faqat " + bars.length + " sham mavjud");
    }
  } catch (err) {
    useTerminal.getState().pushToast("Tarix yuklashda xatolik");
  } finally {
    useTerminal.getState().setLoadingRange(null);
  }
}
