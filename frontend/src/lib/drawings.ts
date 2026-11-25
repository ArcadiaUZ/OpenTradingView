import { create } from "zustand";
import { useAlerts } from "./alerts";
import { useTerminal } from "../store";

/**
 * Chizma (drawing) asboblari — TradingView'dagi kabi chart ustiga trendline,
 * gorizontal chiziq, to'rtburchak, kanal, matn va hokazolarni chizish.
 *
 * Nuqtalar (time, price) ko'rinishida saqlanadi: vaqt — UTC sekund, narx — absolyut.
 * Shu sababli chizmalar timeframe almashganda ham, tarix yuklanganda ham joyida qoladi.
 * Har bir chizma o'z symboliga bog'langan (instrument almashsa ko'rinmaydi).
 */

export type DrawTool =
  | "trendline"
  | "ray"
  | "hline"
  | "vline"
  | "channel"
  | "rect"
  | "arrow"
  | "brush"
  | "text"
  | "long"
  | "short"
  | "polyline";

export type DrawStyle = "solid" | "dashed" | "dotted";

export type DrawPoint = { time: number; price: number };

export type Drawing = {
  id: string;
  type: DrawTool;
  symbol: string;
  points: DrawPoint[];
  color: string;
  width: number;
  style: DrawStyle;
  fill: boolean;
  text: string;
  fontSize: number;
  locked: boolean;
  createdAt: number;
};

export type DrawDefaults = {
  color: string;
  width: number;
  style: DrawStyle;
  fill: boolean;
  fontSize: number;
};

/** Toolbar tugmalari: tartib, nom, qisqa yordam va nechta nuqta kerakligi. */
export type DrawToolDef = {
  id: DrawTool;
  label: string;
  hint: string;
  points: number;
  key: string;
};

export const DRAW_TOOLS: DrawToolDef[] = [
  { id: "trendline", label: "Trend chizig'i", hint: "2 nuqta: boshi va oxiri", points: 2, key: "T" },
  { id: "ray", label: "Nur", hint: "2 nuqta: chiziq keyingi nuqta tomon davom etadi", points: 2, key: "R" },
  { id: "hline", label: "Gorizontal chiziq", hint: "1 nuqta: narx darajasi", points: 1, key: "H" },
  { id: "vline", label: "Vertikal chiziq", hint: "1 nuqta: vaqt belgisi", points: 1, key: "V" },
  { id: "channel", label: "Parallel kanal", hint: "3 nuqta: asosiy chiziq + kenglik", points: 3, key: "C" },
  { id: "rect", label: "To'rtburchak / zona", hint: "2 nuqta: qarama-qarshi burchaklar", points: 2, key: "B" },
  { id: "arrow", label: "Strelka", hint: "2 nuqta: yo'nalish", points: 2, key: "A" },
  { id: "brush", label: "Qalam", hint: "Tortib chizing, tugatish: Enter yoki 2 marta bosish", points: 0, key: "D" },
  { id: "text", label: "Matn", hint: "1 nuqta: izoh joyi", points: 1, key: "X" },
  { id: "long", label: "Long pozitsiya", hint: "1 bosish: kirish — TP/SL avtomatik 1:1, keyin chetidan tortib to'g'irlang", points: 1, key: "L" },
  { id: "short", label: "Short pozitsiya", hint: "1 bosish: kirish — TP/SL avtomatik 1:1, keyin chetidan tortib to'g'irlang", points: 1, key: "S" },
  { id: "polyline", label: "Ko'p nuqtali chiziq", hint: "Nuqtalarni bosing, tugatish: Enter yoki 2 marta bosish", points: 0, key: "P" },
];

export function drawToolDef(id: DrawTool): DrawToolDef {
  return DRAW_TOOLS.find((item) => item.id === id) || DRAW_TOOLS[0];
}

/** Foydalanuvchi tanlagan rang palitrasi (TradingView'ga o'xshash ohanglar). */
export const COLOR_SWATCHES = [
  "#1e90ff",
  "#26a69a",
  "#ef5350",
  "#f0b90b",
  "#e06666",
  "#7e57c2",
  "#4dd0e1",
  "#ff9800",
  "#b0e0e6",
  "#ffffff",
  "#9aa4b2",
  "#787b86",
];

export const LINE_WIDTHS = [1, 2, 3, 4];
export const TEXT_SIZES = [10, 11, 12, 14, 18, 24];

const STORAGE_KEY = "fx.drawings.v1";
const MAX_DRAWINGS = 1500;

const DEFAULT_DEFAULTS: DrawDefaults = { color: "#1e90ff", width: 1, style: "solid", fill: true, fontSize: 12 };

const TOOL_IDS: DrawTool[] = DRAW_TOOLS.map((item) => item.id);

let idSeq = 0;

function makeId(): string {
  idSeq += 1;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (err) {
    /* crypto yo'q */
  }
  return "dr-" + Date.now().toString(36) + "-" + idSeq.toString(36) + Math.random().toString(36).slice(2, 6);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitizePoint(raw: unknown): DrawPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const time = Number(item.time);
  const price = Number(item.price);
  if (!isFinite(time) || time <= 0) return null;
  if (!isFinite(price) || price <= 0) return null;
  return { time: Math.round(time), price };
}

function sanitizeDrawing(raw: unknown): Drawing | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.type !== "string" || !TOOL_IDS.includes(item.type as DrawTool)) return null;
  if (typeof item.symbol !== "string" || !item.symbol) return null;
  if (!Array.isArray(item.points)) return null;
  const points: DrawPoint[] = [];
  for (const entry of item.points) {
    const point = sanitizePoint(entry);
    if (point) points.push(point);
    if (points.length > 4000) break;
  }
  const def = drawToolDef(item.type as DrawTool);
  if (!points.length) return null;
  if (def.points > 0 && points.length < def.points) return null;
  const style = item.style === "dashed" || item.style === "dotted" ? item.style : "solid";
  return {
    id: item.id,
    type: item.type as DrawTool,
    symbol: String(item.symbol).toUpperCase(),
    points,
    color: typeof item.color === "string" && /^#[0-9a-f]{3,8}$/i.test(item.color) ? item.color : "#1e90ff",
    width: clampNumber(item.width, 1, 4, 1),
    style,
    fill: item.fill === true,
    text: typeof item.text === "string" ? item.text.slice(0, 200) : "",
    fontSize: clampNumber(item.fontSize, 8, 32, 12),
    locked: item.locked === true,
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
  };
}

type Persisted = { drawings: Drawing[]; defaults: DrawDefaults };

function loadPersisted(): Persisted {
  const fallback: Persisted = { drawings: [], defaults: DEFAULT_DEFAULTS };
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const data = parsed as Record<string, unknown>;
    const list = Array.isArray(data.drawings) ? data.drawings : [];
    const drawings: Drawing[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
      const drawing = sanitizeDrawing(entry);
      if (!drawing || seen.has(drawing.id)) continue;
      seen.add(drawing.id);
      drawings.push(drawing);
      if (drawings.length >= MAX_DRAWINGS) break;
    }
    const rawDefaults = (data.defaults || {}) as Record<string, unknown>;
    const defaults: DrawDefaults = {
      color: typeof rawDefaults.color === "string" && /^#[0-9a-f]{3,8}$/i.test(rawDefaults.color) ? rawDefaults.color : DEFAULT_DEFAULTS.color,
      width: clampNumber(rawDefaults.width, 1, 4, DEFAULT_DEFAULTS.width),
      style: rawDefaults.style === "dashed" || rawDefaults.style === "dotted" ? rawDefaults.style : "solid",
      fill: rawDefaults.fill === true,
      fontSize: clampNumber(rawDefaults.fontSize, 8, 32, DEFAULT_DEFAULTS.fontSize),
    };
    return { drawings, defaults };
  } catch (err) {
    return fallback;
  }
}

function savePersisted(drawings: Drawing[], defaults: DrawDefaults): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drawings, defaults }));
  } catch (err) {
    /* localStorage to'lgan bo'lsa jim o'tamiz */
  }
}

const persisted = loadPersisted();

export type DrawingsState = {
  drawings: Drawing[];
  /** Qoralama (chizilayotgan) nuqtalar. Tool tanlanganda null bo'ladi. */
  draft: DrawPoint[] | null;
  tool: DrawTool | null;
  selectedId: string | null;
  defaults: DrawDefaults;
  /** Barcha chizmalarni vaqtincha yashirish (TradingView'dagi ko'z tugmasi). */
  hidden: boolean;
  setTool: (tool: DrawTool | null) => void;
  setDraft: (points: DrawPoint[] | null) => void;
  commit: (input: { type: DrawTool; symbol: string; points: DrawPoint[]; text?: string }) => string | null;
  update: (id: string, patch: Partial<Omit<Drawing, "id" | "symbol" | "createdAt">>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  toggleLock: (id: string) => void;
  select: (id: string | null) => void;
  setDefaults: (patch: Partial<DrawDefaults>) => void;
  clearSymbol: (symbol: string) => void;
  clearAll: () => void;
  setHidden: (value: boolean) => void;
  bringToFront: (id: string) => void;
};

export const useDrawings = create<DrawingsState>()((set, get) => ({
  drawings: persisted.drawings,
  draft: null,
  tool: null,
  selectedId: null,
  defaults: persisted.defaults,
  hidden: false,

  setTool: (tool) => set({ tool, draft: null, selectedId: null }),

  setDraft: (points) => set({ draft: points }),

  commit: ({ type, symbol, points, text }) => {
    const def = drawToolDef(type);
    if (!points.length) return null;
    if (def.points > 0 && points.length < def.points) return null;
    const defaults = get().defaults;
    const drawing: Drawing = {
      id: makeId(),
      type,
      symbol: symbol.toUpperCase(),
      points: points.map((point) => ({ time: Math.round(point.time), price: point.price })),
      color: defaults.color,
      width: defaults.width,
      style: defaults.style,
      fill: defaults.fill && (type === "rect" || type === "channel" || type === "long" || type === "short"),
      text: typeof text === "string" ? text.slice(0, 200) : "",
      fontSize: defaults.fontSize,
      locked: false,
      createdAt: Date.now(),
    };
    set((state) => ({ drawings: [...state.drawings, drawing].slice(-MAX_DRAWINGS), draft: null, selectedId: drawing.id }));
    return drawing.id;
  },

  update: (id, patch) =>
    set((state) => ({
      drawings: state.drawings.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),

  remove: (id) =>
    set((state) => ({
      drawings: state.drawings.filter((item) => item.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  duplicate: (id) => {
    const source = get().drawings.find((item) => item.id === id);
    if (!source) return;
    const copy: Drawing = {
      ...source,
      id: makeId(),
      createdAt: Date.now(),
      points: source.points.map((point) => ({ ...point })),
      locked: false,
    };
    // Nusxa biroz pastga siljitiladi, shunda u asl nusxa ustida ko'rinadi.
    const span = Math.max(...source.points.map((point) => point.price)) - Math.min(...source.points.map((point) => point.price));
    const shift = span > 0 ? span * 0.08 : source.points[0].price * 0.0004;
    copy.points = copy.points.map((point) => ({ ...point, price: point.price - shift }));
    set((state) => ({ drawings: [...state.drawings, copy].slice(-MAX_DRAWINGS), selectedId: copy.id }));
  },

  toggleLock: (id) =>
    set((state) => ({
      drawings: state.drawings.map((item) => (item.id === id ? { ...item, locked: !item.locked } : item)),
    })),

  select: (id) => set({ selectedId: id }),

  setDefaults: (patch) => set((state) => ({ defaults: { ...state.defaults, ...patch } })),

  clearSymbol: (symbol) =>
    set((state) => ({
      drawings: state.drawings.filter((item) => item.symbol !== symbol),
      selectedId: null,
    })),

  clearAll: () => set({ drawings: [], selectedId: null, draft: null }),

  setHidden: (value) => set({ hidden: value }),

  bringToFront: (id) =>
    set((state) => {
      const item = state.drawings.find((entry) => entry.id === id);
      if (!item) return state;
      return { drawings: [...state.drawings.filter((entry) => entry.id !== id), item] };
    }),
}));

// Faqat chizmalar/standart sozlamalar o'zgarganda yozamiz.
let savedDrawings: Drawing[] | null = persisted.drawings;
let savedDefaults: DrawDefaults = persisted.defaults;

useDrawings.subscribe((state) => {
  if (state.drawings === savedDrawings && state.defaults === savedDefaults) return;
  savedDrawings = state.drawings;
  savedDefaults = state.defaults;
  savePersisted(state.drawings, state.defaults);
});

/**
 * Chizma narxiga alert qo'shish (sozlamalar panelidagi qo'ng'iroq tugmasi).
 * Gorizontal chiziq/nur uchun aniq narx, boshqalari uchun oxirgi nuqta narxi olinadi.
 */
export function alertForDrawing(drawing: Drawing): string {
  const price = drawing.type === "hline" || drawing.type === "ray" || drawing.type === "vline" ? drawing.points[0].price : drawing.points[drawing.points.length - 1].price;
  const terminal = useTerminal.getState();
  const quote = terminal.quotes[drawing.symbol];
  const digits =
    terminal.meta && terminal.symbol === drawing.symbol
      ? terminal.meta.digits
      : price >= 1000
        ? 2
        : price >= 10
          ? 3
          : 5;
  if (!isFinite(price) || price <= 0) return "Narx aniqlanmadi";
  if (drawing.type === "vline") return "Vertikal chiziqda narx yo'q";
  const ref = quote ? quote.mid : price;
  const dir: "above" | "below" = ref <= price ? "above" : "below";
  useAlerts.getState().add({
    symbol: drawing.symbol,
    price,
    dir,
    note: drawing.text ? drawing.text : "Chizma",
    digits,
    refPrice: ref,
  });
  return drawing.symbol + " · " + price.toFixed(digits) + " alert qo'shildi";
}
