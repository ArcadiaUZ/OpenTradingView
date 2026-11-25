import { create } from "zustand";
import { TF_SECONDS } from "./format";
import type { Bar } from "./types";
import { useTerminal } from "../store";

/**
 * Bar replay (backtest) dvigateli.
 *
 * Narxlar MT5'dan avtomatik olinadi: /api/history?before=... — hech qanday fayl
 * import qilinmaydi. Replay "kursor"i — UTC sekunddagi vaqt belgisi; chart faqat
 * shu vaqtgacha bo'lgan shammlarni ko'rsatadi. Timeframe yoki instrument almashsa
 * kursor saqlanadi (boshidan boshlanmaydi) — TradingView'dagi kabi.
 */

const HISTORY_URL = "/api/history";
const PAST_BARS = 1500;
const FUTURE_BARS = 3000;
const MAX_LOADED = 12000;
const SPEED_KEY = "fx.replay.speed.v1";

export type ReplaySpeed = 0.5 | 1 | 2 | 4 | 8;
export const REPLAY_SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 4, 8];

export type ReplayState = {
  active: boolean;
  symbol: string;
  tf: string;
  /** Oxirgi ochilgan sham vaqti (UTC sekund). */
  cursor: number | null;
  /** Joriy tf uchun yuklangan shamlar (kelajakdagilari ham bo'lishi mumkin). */
  bars: Bar[];
  playing: boolean;
  speed: ReplaySpeed;
  loading: boolean;
  error: string | null;
  /** Replay boshlangan nuqta (ko'rsatish uchun). */
  startAt: number | null;
  start: (fromTs: number) => Promise<boolean>;
  stop: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  step: (dir: 1 | -1) => Promise<void>;
  jump: (ts: number) => Promise<void>;
  /** Timeframe almashganda kursorni saqlab, yangi tf ma'lumotini yuklaydi. */
  loadTf: (tf: string) => Promise<void>;
  /** Instrument almashganda kursorni saqlab, yangi symbol ma'lumotini yuklaydi. */
  bindSymbol: (symbol: string) => Promise<void>;
  /** Oldinga qo'shimcha shamlar yuklash. */
  extend: () => Promise<void>;
  /** Orqaga qo'shimcha tarix yuklash. */
  backfill: () => Promise<void>;
};

export type ReplayUiState = {
  open: boolean;
  setOpen: (value: boolean) => void;
};

function readSpeed(): ReplaySpeed {
  try {
    const raw = Number(window.localStorage.getItem(SPEED_KEY));
    if (REPLAY_SPEEDS.indexOf(raw as ReplaySpeed) >= 0) return raw as ReplaySpeed;
  } catch (err) {
    /* ignore */
  }
  return 1;
}

function saveSpeed(speed: ReplaySpeed): void {
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch (err) {
    /* ignore */
  }
}

function tfSeconds(tf: string): number {
  return TF_SECONDS[tf] || 60;
}

function validBar(raw: unknown): raw is Bar {
  if (!raw || typeof raw !== "object") return false;
  const bar = raw as Record<string, unknown>;
  return (
    typeof bar.time === "number" &&
    Number.isFinite(bar.time) &&
    typeof bar.open === "number" &&
    typeof bar.high === "number" &&
    typeof bar.low === "number" &&
    typeof bar.close === "number" &&
    bar.time > 0
  );
}

async function fetchBefore(symbol: string, tf: string, before: number, count: number): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol,
    tf,
    count: String(Math.max(10, Math.min(5000, Math.round(count)))),
    before: String(Math.max(1, Math.floor(before))),
  });
  const response = await fetch(HISTORY_URL + "?" + params.toString());
  if (!response.ok) throw new Error("Tarixni yuklab bo'lmadi (" + response.status + ")");
  const payload = (await response.json()) as { bars?: unknown };
  const list = Array.isArray(payload.bars) ? payload.bars.filter(validBar) : [];
  list.sort((a, b) => a.time - b.time);
  return list;
}

function mergeBars(first: Bar[], second: Bar[]): Bar[] {
  if (!first.length) return second.slice(-MAX_LOADED);
  if (!second.length) return first.slice(-MAX_LOADED);
  const map = new Map<number, Bar>();
  first.forEach((bar) => map.set(bar.time, bar));
  second.forEach((bar) => map.set(bar.time, bar));
  return Array.from(map.values()).sort((a, b) => a.time - b.time).slice(-MAX_LOADED);
}

function lastIndexAtOrBefore(bars: Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Berilgan vaqtgacha ko'rinadigan shamlar (chart shularni chizadi). */
export function revealedBars(): Bar[] {
  const state = useReplay.getState();
  if (!state.active || state.cursor === null || !state.bars.length) return [];
  const index = lastIndexAtOrBefore(state.bars, state.cursor);
  return index < 0 ? [] : state.bars.slice(0, index + 1);
}

export function replayLastBar(): Bar | null {
  const list = revealedBars();
  return list.length ? list[list.length - 1] : null;
}

/** Replay paytida joriy (kursor) narxi; boshqa instrument uchun null. */
export function replayMid(symbol: string): number | null {
  const state = useReplay.getState();
  if (!state.active || state.symbol !== symbol) return null;
  const bar = replayLastBar();
  return bar ? bar.close : null;
}

/** Backtest uchun spread: jonli quote'dagi ask-bid (bo'lmasa 0). */
export function replaySpread(symbol: string): number {
  const quote = useTerminal.getState().quotes[symbol];
  if (!quote) return 0;
  const spread = Number(quote.ask) - Number(quote.bid);
  return Number.isFinite(spread) && spread > 0 ? spread : 0;
}

let loadToken = 0;
let extendBusy = false;
let extendStamp = 0;

export const useReplay = create<ReplayState>()((set, get) => ({
  active: false,
  symbol: "",
  tf: "1m",
  cursor: null,
  bars: [],
  playing: false,
  speed: readSpeed(),
  loading: false,
  error: null,
  startAt: null,

  start: async (fromTs) => {
    const terminal = useTerminal.getState();
    const symbol = terminal.symbol;
    const tf = terminal.tf;
    const step = tfSeconds(tf);
    const anchor = Math.floor(fromTs / step) * step;
    if (!Number.isFinite(anchor) || anchor <= 0) {
      set({ error: "Sana noto'g'ri" });
      return false;
    }
    loadToken += 1;
    const token = loadToken;
    set({
      active: true,
      loading: true,
      error: null,
      symbol,
      tf,
      playing: false,
      cursor: null,
      bars: [],
      startAt: anchor,
    });

    try {
      const past = await fetchBefore(symbol, tf, anchor + step, PAST_BARS);
      if (token !== loadToken) return false;
      const cutoff = anchor + FUTURE_BARS * step + step;
      const future = await fetchBefore(symbol, tf, cutoff, FUTURE_BARS);
      if (token !== loadToken) return false;
      const bars = mergeBars(past, future);
      if (!bars.length) {
        set({ loading: false, error: "Bu vaqt uchun tarix topilmadi", active: false });
        return false;
      }
      const index = lastIndexAtOrBefore(bars, anchor);
      const cursor = index >= 0 ? bars[index].time : bars[0].time;
      // Boshlanishda pauza: foydalanuvchi o'zi "Play" bosadi (TradingView kabi).
      set({ bars, cursor, loading: false, playing: false });
      if (Math.abs(cursor - anchor) > step * 3) {
        const when = new Date(cursor * 1000).toLocaleString("uz-UZ", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        useTerminal.getState().pushToast("Tanlangan vaqtda bozor yopiq edi — replay " + when + " dan boshlandi");
      }
      return true;
    } catch (err) {
      if (token !== loadToken) return false;
      set({
        loading: false,
        active: false,
        error: err instanceof Error ? err.message : "Tarixni yuklab bo'lmadi",
      });
      return false;
    }
  },

  stop: () => {
    loadToken += 1;
    set({
      active: false,
      playing: false,
      loading: false,
      bars: [],
      cursor: null,
      startAt: null,
      error: null,
      symbol: "",
    });
  },

  play: () => {
    if (!get().active || get().loading) return;
    set({ playing: true });
  },

  pause: () => set({ playing: false }),

  toggle: () => {
    if (!get().active) return;
    set({ playing: !get().playing });
  },

  setSpeed: (speed) => {
    const value = REPLAY_SPEEDS.indexOf(speed) >= 0 ? speed : 1;
    saveSpeed(value);
    set({ speed: value });
  },

  step: async (dir) => {
    const state = get();
    if (!state.active || state.loading) return;
    let bars = state.bars;
    if (!bars.length) return;
    let index = state.cursor === null ? -1 : lastIndexAtOrBefore(bars, state.cursor);

    if (dir > 0) {
      if (index + 1 >= bars.length) {
        await get().extend();
        bars = get().bars;
        index = state.cursor === null ? -1 : lastIndexAtOrBefore(bars, get().cursor || state.cursor || 0);
        if (index + 1 >= bars.length) return;
      }
      const next = bars[index + 1];
      set({ cursor: next.time });
      // Oldinda kam sham qolsa — fonda yuklab turamiz (o'ynash to'xtamasin).
      if (bars.length - index < 120 && !extendBusy && Date.now() - extendStamp > 2500) void get().extend();
    } else {
      if (index <= 0) {
        await get().backfill();
        bars = get().bars;
        index = get().cursor === null ? -1 : lastIndexAtOrBefore(bars, get().cursor as number);
      }
      if (index <= 0) return;
      set({ cursor: bars[index - 1].time });
    }
  },

  jump: async (ts) => {
    const state = get();
    if (!state.active) return;
    const step = tfSeconds(state.tf);
    const anchor = Math.floor(ts / step) * step;
    loadToken += 1;
    const token = loadToken;
    set({ loading: true, error: null });
    try {
      const past = await fetchBefore(state.symbol, state.tf, anchor + step, PAST_BARS);
      if (token !== loadToken) return;
      const future = await fetchBefore(state.symbol, state.tf, anchor + FUTURE_BARS * step + step, FUTURE_BARS);
      if (token !== loadToken) return;
      const bars = mergeBars(past, future);
      const index = lastIndexAtOrBefore(bars, anchor);
      set({
        bars,
        cursor: index >= 0 ? bars[index].time : bars.length ? bars[0].time : null,
        loading: false,
        startAt: anchor,
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ loading: false, error: err instanceof Error ? err.message : "Tarixni yuklab bo'lmadi" });
    }
  },

  loadTf: async (tf) => {
    const state = get();
    if (!state.active || !state.symbol || state.cursor === null || state.tf === tf) return;
    const step = tfSeconds(tf);
    const cursor = state.cursor;
    const symbol = state.symbol;
    loadToken += 1;
    const token = loadToken;
    set({ loading: true, error: null });
    try {
      const past = await fetchBefore(symbol, tf, cursor + step, PAST_BARS);
      if (token !== loadToken) return;
      const future = await fetchBefore(symbol, tf, cursor + FUTURE_BARS * step + step, FUTURE_BARS);
      if (token !== loadToken) return;
      const bars = mergeBars(past, future);
      if (!bars.length) {
        set({ loading: false, error: "Bu timeframe uchun tarix topilmadi" });
        return;
      }
      const index = lastIndexAtOrBefore(bars, cursor);
      // Kursor saqlanadi (eng yaqin shamga tekislanadi): replay boshidan boshlanmaydi.
      set({
        tf,
        bars,
        cursor: index >= 0 ? bars[index].time : bars[0].time,
        loading: false,
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ loading: false, error: err instanceof Error ? err.message : "Tarixni yuklab bo'lmadi" });
    }
  },

  bindSymbol: async (symbol) => {
    const state = get();
    if (!state.active || !symbol || state.symbol === symbol || state.cursor === null) return;
    const tf = state.tf;
    const cursor = state.cursor;
    const step = tfSeconds(tf);
    loadToken += 1;
    const token = loadToken;
    set({ loading: true, error: null });
    try {
      const past = await fetchBefore(symbol, tf, cursor + step, PAST_BARS);
      if (token !== loadToken) return;
      const future = await fetchBefore(symbol, tf, cursor + FUTURE_BARS * step + step, FUTURE_BARS);
      if (token !== loadToken) return;
      const bars = mergeBars(past, future);
      if (!bars.length) {
        set({ loading: false, error: "Bu instrument uchun tarix topilmadi" });
        return;
      }
      const index = lastIndexAtOrBefore(bars, cursor);
      set({
        symbol,
        bars,
        cursor: index >= 0 ? bars[index].time : bars[0].time,
        loading: false,
      });
    } catch (err) {
      if (token !== loadToken) return;
      set({ loading: false, error: err instanceof Error ? err.message : "Tarixni yuklab bo'lmadi" });
    }
  },

  extend: async () => {
    const state = get();
    if (!state.active || !state.bars.length || extendBusy) return;
    extendBusy = true;
    extendStamp = Date.now();
    const step = tfSeconds(state.tf);
    const last = state.bars[state.bars.length - 1].time;
    const count = 2000;
    try {
      const chunk = await fetchBefore(state.symbol, state.tf, last + count * step, count);
      const more = chunk.filter((bar) => bar.time > last);
      if (!more.length) {
        set({ playing: false });
        useTerminal.getState().pushToast("Replay joriy vaqtga yetdi — keyingi shamlar hali yo'q");
        return;
      }
      set({ bars: mergeBars(get().bars, more) });
    } catch (err) {
      set({ playing: false, error: err instanceof Error ? err.message : "Tarixni yuklab bo'lmadi" });
    } finally {
      extendBusy = false;
    }
  },

  backfill: async () => {
    const state = get();
    if (!state.active || !state.bars.length) return;
    const step = tfSeconds(state.tf);
    const first = state.bars[0].time;
    try {
      const older = await fetchBefore(state.symbol, state.tf, first, 1000);
      const fresh = older.filter((bar) => bar.time < first);
      if (!fresh.length) return;
      set({ bars: mergeBars(fresh, get().bars) });
    } catch (err) {
      /* jim */
    }
  },
}));

export const useReplayUI = create<ReplayUiState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}));

export function openReplayPanel(): void {
  useReplayUI.getState().setOpen(true);
}

export function closeReplayPanel(): void {
  useReplayUI.getState().setOpen(false);
}

/** Replay paytida o'ynash taymeri (App mount qiladi). */
export function startReplayTimer(): () => void {
  let timer = 0;
  let lastSpeed = 0;
  let lastPlaying = false;
  const tick = () => {
    const state = useReplay.getState();
    if (!state.active || !state.playing) {
      lastPlaying = false;
      return;
    }
    void state.step(1);
  };
  const apply = () => {
    const state = useReplay.getState();
    if (state.playing === lastPlaying && state.speed === lastSpeed) return;
    lastPlaying = state.playing;
    lastSpeed = state.speed;
    window.clearInterval(timer);
    if (!state.playing) return;
    timer = window.setInterval(tick, Math.max(110, Math.round(1000 / state.speed)));
  };
  const unsubscribe = useReplay.subscribe(apply);
  apply();
  return () => {
    window.clearInterval(timer);
    unsubscribe();
  };
}
