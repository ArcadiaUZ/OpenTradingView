import { create } from "zustand";

/* ------------------------------------------------------------------ types */

export type Side = "buy" | "sell";

export type Position = {
  id: string;
  symbol: string;
  side: Side;
  lots: number;
  entry: number;
  sl: number | null;
  tp: number | null;
  opened: number;
  digits: number;
};

export type ClosedTrade = {
  id: string;
  symbol: string;
  side: Side;
  lots: number;
  entry: number;
  exit: number;
  pnl: number;
  opened: number;
  closed: number;
};

export type OpenTradeInput = {
  side: Side;
  lots: number;
  symbol: string;
  price: number;
  digits: number;
  sl?: number | null;
  tp?: number | null;
};

export type PaperResult = { ok: boolean; message: string };

export type PaperState = {
  balance: number;
  lots: number;
  positions: Position[];
  history: ClosedTrade[];
  open: (input: OpenTradeInput) => PaperResult;
  close: (id: string, price: number) => void;
  closeAll: (prices: Record<string, number>) => void;
  setLots: (v: number) => void;
  reset: () => void;
};

/* -------------------------------------------------------------- constants */

export const PAPER_STORAGE_KEY = "fx.paper.v1";
export const PAPER_START_BALANCE = 10000;
export const DEFAULT_LOTS = 0.1;
export const MIN_LOTS = 0.01;
export const MAX_LOTS = 100;
const HISTORY_MAX = 100;
const FOREX_CONTRACT = 100000;
const GOLD_CONTRACT = 100;

/* ------------------------------------------------------------ money maths */

function contractSize(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.indexOf("XAU") === 0) return GOLD_CONTRACT;
  return FOREX_CONTRACT;
}

/**
 * Floating / realised PnL of one position in account currency (USD), at the
 * given price. Not rounded - callers round for display / balance maths.
 *
 * contract = 100000 for forex, 100 for gold (XAUUSD).
 * USD-quote pairs (EURUSD, XAUUSD, ...): pnl = (price - entry) * dir * lots * contract
 * USD-base  pairs (USDJPY, USDCAD, ...): pnl = (price - entry) * dir * lots * contract / price
 */
export function positionPnl(pos: Position, price: number): number {
  const entry = Number(pos.entry);
  const p = Number(price);
  if (!Number.isFinite(entry) || !Number.isFinite(p) || p <= 0) return 0;
  const dir = pos.side === "sell" ? -1 : 1;
  const lots = Number.isFinite(pos.lots) ? Number(pos.lots) : 0;
  const contract = contractSize(pos.symbol);
  const symbol = pos.symbol.toUpperCase();
  if (symbol.endsWith("USD")) {
    return (p - entry) * dir * lots * contract;
  }
  if (symbol.startsWith("USD")) {
    return ((p - entry) * dir * lots * contract) / p;
  }
  return (p - entry) * dir * lots * contract;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function clampLots(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LOTS;
  const clamped = Math.min(MAX_LOTS, Math.max(MIN_LOTS, n));
  return Math.round(clamped * 100) / 100;
}

function clampDigits(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(8, Math.max(0, Math.round(n)));
}

/* --------------------------------------------------------------- persist */

type Snapshot = {
  balance: number;
  lots: number;
  positions: Position[];
  history: ClosedTrade[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSide(value: unknown): Side | null {
  return value === "buy" || value === "sell" ? value : null;
}

function readLevel(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function sanitizePosition(raw: unknown): Position | null {
  if (!isRecord(raw)) return null;
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  const side = readSide(raw.side);
  const entry = finiteNumber(raw.entry);
  const lots = finiteNumber(raw.lots);
  const opened = finiteNumber(raw.opened);
  if (!symbol || !side || entry === null || entry <= 0 || lots === null) return null;
  const id =
    typeof raw.id === "string" && raw.id ? raw.id : "p" + (opened !== null ? opened : Date.now()).toString(36);
  return {
    id,
    symbol,
    side,
    lots: clampLots(lots),
    entry,
    sl: readLevel(raw.sl),
    tp: readLevel(raw.tp),
    opened: opened !== null && opened > 0 ? opened : Date.now(),
    digits: clampDigits(raw.digits),
  };
}

function sanitizeClosed(raw: unknown): ClosedTrade | null {
  if (!isRecord(raw)) return null;
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  const side = readSide(raw.side);
  const entry = finiteNumber(raw.entry);
  const exit = finiteNumber(raw.exit);
  const lots = finiteNumber(raw.lots);
  const pnl = finiteNumber(raw.pnl);
  if (!symbol || !side || entry === null || entry <= 0 || exit === null || exit <= 0 || lots === null || pnl === null) {
    return null;
  }
  const opened = finiteNumber(raw.opened);
  const closed = finiteNumber(raw.closed);
  const id = typeof raw.id === "string" && raw.id ? raw.id : "c" + (closed !== null ? closed : Date.now()).toString(36);
  return {
    id,
    symbol,
    side,
    lots: clampLots(lots),
    entry,
    exit,
    pnl: round2(pnl),
    opened: opened !== null && opened > 0 ? opened : closed !== null && closed > 0 ? closed : Date.now(),
    closed: closed !== null && closed > 0 ? closed : Date.now(),
  };
}

function loadSnapshot(): Snapshot {
  const empty: Snapshot = {
    balance: PAPER_START_BALANCE,
    lots: DEFAULT_LOTS,
    positions: [],
    history: [],
  };
  if (typeof window === "undefined") return empty;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PAPER_STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return empty;
    const balance = finiteNumber(data.balance);
    const lots = finiteNumber(data.lots);
    const positions = Array.isArray(data.positions)
      ? data.positions.map(sanitizePosition).filter((item): item is Position => item !== null)
      : [];
    const history = Array.isArray(data.history)
      ? data.history
          .map(sanitizeClosed)
          .filter((item): item is ClosedTrade => item !== null)
          .slice(0, HISTORY_MAX)
      : [];
    return {
      balance: balance !== null && balance >= 0 ? round2(balance) : PAPER_START_BALANCE,
      lots: lots !== null ? clampLots(lots) : DEFAULT_LOTS,
      positions,
      history,
    };
  } catch {
    return empty;
  }
}

function saveSnapshot(state: PaperState): void {
  if (typeof window === "undefined") return;
  try {
    const payload: Snapshot = {
      balance: state.balance,
      lots: state.lots,
      positions: state.positions,
      history: state.history.slice(0, HISTORY_MAX),
    };
    window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota - paper trading keeps working in memory */
  }
}

/* ------------------------------------------------------------------- ids */

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return prefix + Date.now().toString(36) + "-" + idSeq.toString(36);
}

/* ------------------------------------------------------------------ store */

const initial = loadSnapshot();

export const usePaper = create<PaperState>((set, get) => ({
  balance: initial.balance,
  lots: initial.lots,
  positions: initial.positions,
  history: initial.history,

  open: (input) => {
    const state = get();
    const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, message: "Instrument tanlanmagan" };

    const price = Number(input.price);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, message: "Narx mavjud emas — ulanishni kuting" };
    }

    const side: Side = input.side === "sell" ? "sell" : "buy";
    const lots = clampLots(input.lots);
    const digits = clampDigits(input.digits);

    const readSl = (value: number | null | undefined): number | null | undefined => {
      if (value === null || value === undefined) return null;
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const sl = readSl(input.sl);
    const tp = readSl(input.tp);
    if (sl === undefined) return { ok: false, message: "SL narxi noto‘g‘ri" };
    if (tp === undefined) return { ok: false, message: "TP narxi noto‘g‘ri" };

    if (side === "buy") {
      if (sl !== null && sl >= price) return { ok: false, message: "BUY: SL narxdan past bo‘lishi kerak" };
      if (tp !== null && tp <= price) return { ok: false, message: "BUY: TP narxdan yuqori bo‘lishi kerak" };
    } else {
      if (sl !== null && sl <= price) return { ok: false, message: "SELL: SL narxdan yuqori bo‘lishi kerak" };
      if (tp !== null && tp >= price) return { ok: false, message: "SELL: TP narxdan past bo‘lishi kerak" };
    }

    const position: Position = {
      id: nextId("p"),
      symbol,
      side,
      lots,
      entry: price,
      sl,
      tp,
      opened: Date.now(),
      digits,
    };

    set({ positions: [position, ...state.positions] });
    return {
      ok: true,
      message: (side === "buy" ? "BUY" : "SELL") + " " + symbol + " " + lots.toFixed(2) + " lot ochildi · " + price.toFixed(digits),
    };
  },

  close: (id, price) => {
    const state = get();
    const position = state.positions.find((item) => item.id === id);
    if (!position) return;
    const exit = Number(price);
    if (!Number.isFinite(exit) || exit <= 0) return;
    const pnl = round2(positionPnl(position, exit));
    const trade: ClosedTrade = {
      id: nextId("c"),
      symbol: position.symbol,
      side: position.side,
      lots: position.lots,
      entry: position.entry,
      exit,
      pnl,
      opened: position.opened,
      closed: Date.now(),
    };
    set({
      balance: round2(state.balance + pnl),
      positions: state.positions.filter((item) => item.id !== id),
      history: [trade, ...state.history].slice(0, HISTORY_MAX),
    });
  },

  closeAll: (prices) => {
    const state = get();
    if (!state.positions.length) return;
    const map: Record<string, number> = prices && typeof prices === "object" ? prices : {};
    let balance = state.balance;
    const closed: ClosedTrade[] = [];
    for (const position of state.positions) {
      const raw = map[position.symbol];
      const candidate = Number(raw);
      const exit = Number.isFinite(candidate) && candidate > 0 ? candidate : position.entry;
      const pnl = round2(positionPnl(position, exit));
      balance = round2(balance + pnl);
      closed.push({
        id: nextId("c"),
        symbol: position.symbol,
        side: position.side,
        lots: position.lots,
        entry: position.entry,
        exit,
        pnl,
        opened: position.opened,
        closed: Date.now(),
      });
    }
    set({
      balance: round2(balance),
      positions: [],
      history: [...closed, ...state.history].slice(0, HISTORY_MAX),
    });
  },

  setLots: (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    set({ lots: clampLots(n) });
  },

  reset: () =>
    set({
      balance: PAPER_START_BALANCE,
      lots: DEFAULT_LOTS,
      positions: [],
      history: [],
    }),
}));

// Persist every change (opens, closes, lot size, reset) defensively.
usePaper.subscribe((state) => {
  saveSnapshot(state);
});

/* ---------------------------------------------------------- panel control */

export type PaperPanelState = {
  /** Whether the trade panel is visible. */
  open: boolean;
  /** Side preselected by openTrade()/the ticket buttons. */
  side: Side;
  openPanel: (side?: Side) => void;
  setSide: (side: Side) => void;
  togglePanel: () => void;
  closePanel: () => void;
};

/**
 * Visibility / preselected-side state for the panel. Kept in its own store so
 * TradePanel can return null while closed and so openTrade() can open it from
 * anywhere (top bar Trade button, chart SELL/BUY ticket).
 */
export const usePaperUI = create<PaperPanelState>((set, get) => ({
  open: false,
  side: "buy",
  openPanel: (side) => set(side === "sell" ? { open: true, side: "sell" } : side === "buy" ? { open: true, side: "buy" } : { open: true }),
  setSide: (side) => set({ side }),
  togglePanel: () => set({ open: !get().open }),
  closePanel: () => set({ open: false }),
}));

/**
 * Open the paper-trading panel, preselecting the side. Called by the top bar
 * "Trade" button (openTrade()) and by chart ticket buttons (openTrade("sell") /
 * openTrade("buy")). Does NOT place an order: the user confirms in the panel.
 */
export function openTrade(side: Side = "buy"): void {
  usePaperUI.getState().openPanel(side);
}

/** Close the paper-trading panel from anywhere. */
export function closeTradePanel(): void {
  usePaperUI.getState().closePanel();
}

/** Toggle the paper-trading panel from anywhere. */
export function toggleTradePanel(): void {
  usePaperUI.getState().togglePanel();
}
