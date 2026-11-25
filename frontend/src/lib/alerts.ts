import { create } from "zustand";

/**
 * Narx alerti: foydalanuvchi belgilagan narxga bozor yetganda bir marta ogohlantiradi.
 * Panel va top bar badge'i shu tipdagi yozuvlar bilan ishlaydi.
 */
export type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
  dir: "above" | "below";
  note: string;
  digits: number;
  createdAt: number;
  triggeredAt: number | null;
  active: boolean;
  /**
   * Alert faqat "crossing" bo'lganda ishlaydi: yangi alert joriy narx shartni
   * allaqachon qanoatlantirsa (masalan narx = alert narxi), primed=false bo'lib
   * turadi va narx boshqa tomonga chiqib, keyin qaytib kesib o'tganda ishlaydi.
   */
  primed: boolean;
};

/** Yangi alert qo'shish uchun kirish ma'lumoti. */
export type AlertInput = {
  symbol: string;
  price: number;
  dir: "above" | "below";
  note?: string;
  digits: number;
  /** Alert yaratilgandagi bozor narxi (crossing semantikasi uchun). */
  refPrice?: number;
};

export type AlertsState = {
  alerts: PriceAlert[];
  open: boolean;
  sound: boolean;
  setOpen: (value: boolean) => void;
  add: (input: AlertInput) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clearTriggered: () => void;
  setSound: (value: boolean) => void;
};

const STORAGE_KEY = "fx.alerts.v1";
const MAX_ALERTS = 200;
const MAX_NOTE = 120;

/** Digits faqat 0..8 oralig'ida mantiqiy; boshqa qiymatlar e'tiborsiz qoldiriladi. */
function safeDigits(value: unknown, fallback = 5): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!isFinite(num)) return fallback;
  const digits = Math.round(num);
  if (digits < 0 || digits > 8) return fallback;
  return digits;
}

function safePrice(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!isFinite(num) || num <= 0) return null;
  return num;
}

function safeTime(value: unknown): number | null {
  if (typeof value !== "number" || !isFinite(value) || value <= 0) return null;
  return value;
}

let idSeq = 0;

function makeId(): string {
  idSeq += 1;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* crypto yo'q bo'lsa pastdagi zaxira ishlatiladi */
  }
  return "al-" + Date.now().toString(36) + "-" + idSeq.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** localStorage'dan kelgan noma'lum yozuvni tekshirib, to'g'ri bo'lsa PriceAlert qaytaradi. */
function sanitizeAlert(raw: unknown): PriceAlert | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.symbol !== "string" || !item.symbol) return null;
  const price = safePrice(item.price);
  if (price === null) return null;
  if (item.dir !== "above" && item.dir !== "below") return null;
  const digits = safeDigits(item.digits);
  const createdAt = safeTime(item.createdAt) ?? Date.now();
  const triggeredAt = item.triggeredAt === null || item.triggeredAt === undefined ? null : safeTime(item.triggeredAt);
  const active = triggeredAt === null ? item.active === true : false;
  const note = typeof item.note === "string" ? item.note.slice(0, MAX_NOTE) : "";
  return {
    id: item.id,
    symbol: item.symbol,
    price,
    dir: item.dir,
    note,
    digits,
    createdAt,
    triggeredAt,
    active,
    // Eski (primed maydoni yo'q) yozuvlar avvalgidek ishlaydi.
    primed: item.primed === false ? false : true,
  };
}

type Persisted = { alerts: PriceAlert[]; sound: boolean };

function loadPersisted(): Persisted {
  const fallback: Persisted = { alerts: [], sound: true };
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const data = parsed as Record<string, unknown>;
    const list = Array.isArray(data.alerts) ? data.alerts : [];
    const alerts: PriceAlert[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
      const alert = sanitizeAlert(entry);
      if (!alert || seen.has(alert.id)) continue;
      seen.add(alert.id);
      alerts.push(alert);
      if (alerts.length >= MAX_ALERTS) break;
    }
    return { alerts, sound: typeof data.sound === "boolean" ? data.sound : true };
  } catch {
    return fallback;
  }
}

function savePersisted(alerts: PriceAlert[], sound: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, alerts, sound }));
  } catch {
    /* localStorage to'lgan / o'chirilgan bo'lsa jim o'tamiz */
  }
}

const persisted = loadPersisted();

export const useAlerts = create<AlertsState>()((set) => ({
  alerts: persisted.alerts,
  open: false,
  sound: persisted.sound,

  setOpen: (value) => set({ open: value }),

  add: (input) => {
    const price = safePrice(input.price);
    if (price === null) return;
    const symbol = String(input.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const note = typeof input.note === "string" ? input.note.trim().slice(0, MAX_NOTE) : "";
    const direction = input.dir === "below" ? "below" : "above";
    const ref = safePrice(input.refPrice) ?? price;
    // Bozor shartni hozir qanoatlantirmasa — keyingi kesib o'tishda ishlaydi.
    const primed = direction === "above" ? ref < price : ref > price;
    const alert: PriceAlert = {
      id: makeId(),
      symbol,
      price,
      dir: direction,
      note,
      digits: safeDigits(input.digits),
      createdAt: Date.now(),
      triggeredAt: null,
      active: true,
      primed,
    };
    set((state) => ({ alerts: [alert, ...state.alerts].slice(0, MAX_ALERTS) }));
  },

  remove: (id) => set((state) => ({ alerts: state.alerts.filter((alert) => alert.id !== id) })),

  // Qayta yoqilganda triggeredAt tozalanadi, shuning uchun alert yana bir marta ishlay oladi.
  toggle: (id) =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, active: !alert.active, triggeredAt: null, primed: false } : alert
      ),
    })),

  clearTriggered: () => set((state) => ({ alerts: state.alerts.filter((alert) => alert.triggeredAt === null) })),

  setSound: (value) => set({ sound: value }),
}));

// Persist faqat alerts/sound o'zgarganda yoziladi (panel ochilishi localStorage'ni bezovta qilmaydi).
let savedAlerts: PriceAlert[] | null = persisted.alerts;
let savedSound = persisted.sound;

useAlerts.subscribe((state) => {
  if (state.alerts === savedAlerts && state.sound === savedSound) return;
  savedAlerts = state.alerts;
  savedSound = state.sound;
  savePersisted(state.alerts, state.sound);
});

/** Top bar'dagi qo'ng'iroq tugmasi panelni shu funksiya bilan ochadi. */
export function openAlerts(): void {
  useAlerts.getState().setOpen(true);
}
