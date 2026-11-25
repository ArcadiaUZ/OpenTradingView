import { create } from "zustand";
import { feedClient } from "./lib/feed";
import type { Bar, FeedStatus, Quote, SymbolMeta } from "./lib/types";

/** How far back the browser may scroll before memory becomes a problem. */
export const MAX_CLIENT_BARS = 20000;

export type ChartData = {
  mode: "init" | "bar" | "tail" | "prepend";
  bars: Bar[];
  tail?: Bar[];
  added?: number;
  seq: number;
} | null;

export type ChartType = "candles" | "bars" | "line" | "area";
export type IndicatorKey = "ema20" | "ema50" | "sma200" | "bb";
export type ChartSettings = { grid: boolean; crosshair: boolean; countdown: boolean };
export type ToolId = "cursor" | "crosshair" | "measure";

export type RangeRequest = { preset: string; seconds: number; seq: number } | null;
export type ViewRequest = { from: number; to: number; seq: number } | null;
export type ChartCommand = {
  kind: "panLeft" | "panRight" | "zoomIn" | "zoomOut" | "realtime" | "resetPrice";
  seq: number;
} | null;
export type Toast = { id: number; text: string } | null;

export type TerminalState = {
  symbol: string;
  tf: string;
  symbols: SymbolMeta[];
  meta: SymbolMeta | null;
  quotes: Record<string, Quote>;
  baseline: Record<string, number>;
  data: ChartData;
  seq: number;
  hover: Bar | null;
  status: FeedStatus | null;
  socketOpen: boolean;
  watchlistOpen: boolean;
  searchOpen: boolean;
  clockTs: number;
  serverOffset: number;
  loadingMore: boolean;
  noMore: boolean;
  loadingRange: string | null;
  chartType: ChartType;
  indicators: Record<IndicatorKey, boolean>;
  settings: ChartSettings;
  settingsOpen: boolean;
  tool: ToolId;
  rangeRequest: RangeRequest;
  viewRequest: ViewRequest;
  chartCmd: ChartCommand;
  toast: Toast;
  requestMore: () => void;
  setSymbol: (value: string) => void;
  setTf: (value: string) => void;
  setSearchOpen: (value: boolean) => void;
  toggleWatchlist: () => void;
  setHover: (value: Bar | null) => void;
  tickClock: () => void;
  setChartType: (value: ChartType) => void;
  toggleIndicator: (key: IndicatorKey) => void;
  setSetting: <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => void;
  setSettingsOpen: (value: boolean) => void;
  setTool: (value: ToolId) => void;
  requestRange: (preset: string, seconds: number) => void;
  setLoadingRange: (value: string | null) => void;
  applyView: (from: number, to: number) => void;
  sendChartCmd: (kind: NonNullable<ChartCommand>["kind"]) => void;
  pushToast: (text: string) => void;
  dismissToast: () => void;
  prependBars: (older: Bar[]) => void;
  replaceBars: (bars: Bar[]) => void;
  handleMessage: (msg: any) => void;
};

function mergeTail(existing: Bar[], incoming: Bar[]): Bar[] {
  if (!incoming.length) return existing;
  const first = incoming[0].time;
  const kept = existing.filter((bar) => bar.time < first);
  return kept.concat(incoming).slice(-MAX_CLIENT_BARS);
}

let toastId = 0;
let toastTimer = 0;

export const useTerminal = create<TerminalState>((set, get) => ({
  symbol: "EURUSD",
  tf: "1m",
  symbols: [],
  meta: null,
  quotes: {},
  baseline: {},
  data: null,
  seq: 0,
  hover: null,
  status: null,
  socketOpen: false,
  watchlistOpen: false,
  searchOpen: false,
  clockTs: Math.floor(Date.now() / 1000),
  serverOffset: 0,
  loadingMore: false,
  noMore: false,
  loadingRange: null,
  chartType: "candles",
  indicators: { ema20: false, ema50: false, sma200: false, bb: false },
  settings: { grid: true, crosshair: true, countdown: true },
  settingsOpen: false,
  tool: "cursor",
  rangeRequest: null,
  viewRequest: null,
  chartCmd: null,
  toast: null,

  requestMore: () => {
    const state = get();
    if (state.loadingMore || state.noMore || !state.data || !state.data.bars.length) return;
    const before = state.data.bars[0].time;
    set({ loadingMore: true });
    feedClient.requestMore(state.symbol, state.tf, before, 1500);
    window.setTimeout(() => {
      if (get().loadingMore) set({ loadingMore: false });
    }, 8000);
  },

  setSymbol: (value) => set({ symbol: value, data: null, hover: null, searchOpen: false, loadingMore: false, noMore: false, viewRequest: null }),
  setTf: (value) => set({ tf: value, data: null, hover: null, loadingMore: false, noMore: false, viewRequest: null }),
  setSearchOpen: (value) => set({ searchOpen: value }),
  toggleWatchlist: () => set({ watchlistOpen: !get().watchlistOpen }),
  setHover: (value) => set({ hover: value }),
  tickClock: () => set({ clockTs: Math.floor(Date.now() / 1000) }),

  setChartType: (value) => set({ chartType: value }),
  toggleIndicator: (key) =>
    set({ indicators: { ...get().indicators, [key]: !get().indicators[key] } }),
  setSetting: (key, value) => set({ settings: { ...get().settings, [key]: value } }),
  setSettingsOpen: (value) => set({ settingsOpen: value }),
  setTool: (value) => set({ tool: value }),
  requestRange: (preset, seconds) => set({ rangeRequest: { preset, seconds, seq: Date.now() } }),
  setLoadingRange: (value) => set({ loadingRange: value }),
  applyView: (from, to) => set({ viewRequest: { from, to, seq: Date.now() } }),
  sendChartCmd: (kind) => set({ chartCmd: { kind, seq: Date.now() } }),
  pushToast: (text) => {
    toastId += 1;
    set({ toast: { id: toastId, text } });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      set({ toast: null });
    }, 3200);
  },
  dismissToast: () => set({ toast: null }),

  prependBars: (older) => {
    const state = get();
    const current = state.data ? state.data.bars : [];
    if (!older.length) return;
    const firstTime = current.length ? current[0].time : Number.MAX_SAFE_INTEGER;
    const fresh = older.filter((bar) => bar.time < firstTime);
    if (!fresh.length) return;
    const merged = fresh.concat(current).slice(-MAX_CLIENT_BARS);
    const seq = state.seq + 1;
    set({ data: { mode: "prepend", bars: merged, added: fresh.length, seq }, seq });
  },

  replaceBars: (bars) => {
    if (!bars.length) return;
    const seq = get().seq + 1;
    set({ data: { mode: "init", bars: bars.slice(-MAX_CLIENT_BARS), seq }, seq, loadingMore: false });
  },

  handleMessage: (msg) => {
    const state = get();
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "socket-open") {
      set({ socketOpen: true });
      return;
    }
    if (msg.type === "socket-close") {
      set({ socketOpen: false });
      return;
    }
    if (msg.type === "hello") {
      const quotes: Record<string, Quote> = msg.quotes || {};
      const baseline: Record<string, number> = { ...state.baseline };
      Object.keys(quotes).forEach((key) => {
        if (baseline[key] === undefined) baseline[key] = quotes[key].mid;
      });
      set({
        symbols: msg.symbols || [],
        status: msg.status || null,
        quotes,
        baseline,
        serverOffset: msg.serverOffset || 0,
        socketOpen: true,
      });
      return;
    }
    if (msg.type === "heartbeat") {
      const quotes: Record<string, Quote> = msg.quotes || {};
      const baseline: Record<string, number> = { ...state.baseline };
      Object.keys(quotes).forEach((key) => {
        if (baseline[key] === undefined) baseline[key] = quotes[key].mid;
      });
      set({ quotes, baseline, status: msg.status || state.status });
      return;
    }
    if (msg.type === "init") {
      if (msg.symbol !== state.symbol || msg.tf !== state.tf) return;
      const seq = state.seq + 1;
      set({
        meta: msg.meta || null,
        data: { mode: "init", bars: msg.bars || [], seq },
        seq,
        hover: null,
        loadingMore: false,
        noMore: false,
      });
      return;
    }
    if (msg.type === "bar") {
      if (msg.symbol !== state.symbol || msg.tf !== state.tf) return;
      const bars = state.data ? state.data.bars : [];
      if (!bars.length) return;
      const last = bars[bars.length - 1];
      let next: Bar[];
      if (msg.bar.time === last.time) {
        next = bars.slice(0, -1).concat([msg.bar]);
      } else if (msg.bar.time > last.time) {
        next = bars.concat([msg.bar]);
      } else {
        return;
      }
      const seq = state.seq + 1;
      set({ data: { mode: "bar", bars: next.slice(-MAX_CLIENT_BARS), seq }, seq });
      return;
    }
    if (msg.type === "more") {
      if (msg.symbol !== state.symbol || msg.tf !== state.tf) return;
      const incoming: Bar[] = (msg.bars || []).filter((bar: Bar) => bar && typeof bar.time === "number");
      const current = state.data ? state.data.bars : [];
      if (!incoming.length) {
        set({ loadingMore: false, noMore: true });
        return;
      }
      const firstTime = current.length ? current[0].time : Number.MAX_SAFE_INTEGER;
      const older = incoming.filter((bar) => bar.time < firstTime);
      if (!older.length) {
        set({ loadingMore: false });
        return;
      }
      const merged = older.concat(current).slice(-MAX_CLIENT_BARS);
      const seq = state.seq + 1;
      set({
        data: { mode: "prepend", bars: merged, added: older.length, seq },
        seq,
        loadingMore: false,
      });
      return;
    }
    if (msg.type === "bars") {
      if (msg.symbol !== state.symbol || msg.tf !== state.tf) return;
      const incoming: Bar[] = msg.bars || [];
      if (!incoming.length) return;
      const current = state.data ? state.data.bars : [];
      const seq = state.seq + 1;
      set({
        data: { mode: "tail", bars: mergeTail(current, incoming), tail: incoming, seq },
        seq,
      });
    }
  },
}));
