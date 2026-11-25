import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bell, BellOff, Trash2, X } from "lucide-react";
import { useAlerts, type PriceAlert } from "../lib/alerts";
import { useTerminal } from "../store";
import "./alerts.css";

const TOAST_MS = 6000;
const MAX_TOASTS = 4;

function pad2(value: number): string {
  return value < 10 ? "0" + value : String(value);
}

function hhmm(ts: number): string {
  const date = new Date(ts);
  return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}

function hhmmss(ts: number): string {
  const date = new Date(ts);
  return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
}

/** Masofa pipsda: abs(price - mid) / (point * 10), bir xonali. */
function pipDistance(price: number, mid: number, point: number): string | null {
  if (!isFinite(price) || !isFinite(mid) || !isFinite(point) || point <= 0) return null;
  const pips = Math.abs(price - mid) / (point * 10);
  if (!isFinite(pips)) return null;
  return pips.toFixed(1);
}

// AudioContext faqat birinchi ovozda yaratiladi (lazy) — sahifa ochilishida brauzer ogohlantirmasin.
let audio: AudioContext | null = null;

function beep(): void {
  try {
    if (typeof window === "undefined") return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audio) audio = new Ctor();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, start);
    osc.frequency.setValueAtTime(1180, start + 0.16);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.36);
  } catch {
    /* audio qurilmasi yo'q bo'lsa jim o'tamiz */
  }
}

function notify(alert: PriceAlert, mid: number): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const arrow = alert.dir === "above" ? "↑" : "↓";
    const title = alert.symbol + " " + arrow + " " + alert.price.toFixed(alert.digits);
    const body = alert.note ? alert.note : "Narx " + mid.toFixed(alert.digits) + " ga yetdi";
    // Ovozni WebAudio chaladi, shuning uchun tizim bildirishnomasi jim.
    new Notification(title, { body, tag: alert.id, silent: true });
  } catch {
    /* ba'zi brauzerlar Notification'ni qo'llab-quvvatlamaydi */
  }
}

type AlertToast = { id: string; alert: PriceAlert; mid: number; at: number };

let toastSeq = 0;

/* ------------------------------------------------------------------------ */
/* Panel tanasi: faqat panel ochiq bo'lganda mount bo'ladi, shuning uchun     */
/* quotes'ga obuna bo'lish narxi faqat panel ochiq paytda to'lanadi.          */
/* ------------------------------------------------------------------------ */
function AlertsBody() {
  const alerts = useAlerts((s) => s.alerts);
  const sound = useAlerts((s) => s.sound);
  const setOpen = useAlerts((s) => s.setOpen);
  const setSound = useAlerts((s) => s.setSound);
  const add = useAlerts((s) => s.add);
  const remove = useAlerts((s) => s.remove);
  const toggle = useAlerts((s) => s.toggle);
  const clearTriggered = useAlerts((s) => s.clearTriggered);

  const quotes = useTerminal((s) => s.quotes);
  const symbol = useTerminal((s) => s.symbol);
  const meta = useTerminal((s) => s.meta);
  const symbols = useTerminal((s) => s.symbols);

  const [dir, setDir] = useState<PriceAlert["dir"]>("above");
  const [priceText, setPriceText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState("");

  const metaBySymbol = useMemo(() => {
    const map = new Map<string, { digits: number; point: number }>();
    symbols.forEach((item) => map.set(item.symbol, { digits: item.digits, point: item.point }));
    return map;
  }, [symbols]);

  const chartMeta = metaBySymbol.get(symbol);
  const digits = meta && meta.digits > 0 ? meta.digits : chartMeta && chartMeta.digits > 0 ? chartMeta.digits : 5;
  const quote = quotes[symbol];
  const mid = quote && isFinite(quote.mid) && quote.mid > 0 ? quote.mid : NaN;

  // Panel ochilganda / instrument almashganda narx maydoni joriy mid bilan to'ldiriladi.
  useEffect(() => {
    const first = useTerminal.getState().quotes[symbol];
    if (first && isFinite(first.mid) && first.mid > 0) {
      setPriceText(first.mid.toFixed(digits));
    } else {
      setPriceText("");
    }
    setError("");
  }, [symbol, digits]);

  const submit = () => {
    const raw = priceText.trim().replace(",", ".");
    const price = Number(raw);
    if (!raw || !isFinite(price) || price <= 0) {
      setError("Narx noto'g'ri");
      return;
    }
    setError("");
    add({ symbol, price, dir, note: noteText, digits, refPrice: Number.isFinite(mid) ? mid : undefined });
    setNoteText("");
    const next = useTerminal.getState().quotes[symbol];
    setPriceText(next && isFinite(next.mid) && next.mid > 0 ? next.mid.toFixed(digits) : price.toFixed(digits));
    // Ruxsat so'rash faqat tugma bosilganda va faqat "default" holatda; javobni kutmaymiz.
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    } catch {
      /* brauzer ruxsat so'ramasa jim o'tamiz */
    }
  };

  let activeCount = 0;
  let firedCount = 0;
  for (const alert of alerts) {
    if (alert.active) activeCount += 1;
    if (alert.triggeredAt !== null) firedCount += 1;
  }

  return (
    <div className="alerts-panel" role="dialog" aria-label="Narx alertlari">
      <div className="alerts-head">
        <span className="alerts-title">
          <Bell size={13} /> Alertlar
        </span>
        <span className="alerts-count">{activeCount} ta faol</span>
        <span className="alerts-gap" />
        <button
          type="button"
          className={sound ? "alerts-icon on" : "alerts-icon"}
          title={sound ? "Ovozni o'chirish" : "Ovozni yoqish"}
          aria-label={sound ? "Ovozni o'chirish" : "Ovozni yoqish"}
          aria-pressed={sound}
          onClick={() => setSound(!sound)}
        >
          {sound ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
        <button type="button" className="alerts-icon" title="Yopish" aria-label="Yopish" onClick={() => setOpen(false)}>
          <X size={14} />
        </button>
      </div>

      <div className="alerts-form">
        <div className="alerts-seg" role="group" aria-label="Alert yo'nalishi">
          <button
            type="button"
            className={"alerts-seg-btn above" + (dir === "above" ? " active" : "")}
            title="Narx bu darajadan yuqoriga chiqsa ogohlantir"
            onClick={() => setDir("above")}
          >
            <ArrowUp size={11} /> Yuqorida
          </button>
          <button
            type="button"
            className={"alerts-seg-btn below" + (dir === "below" ? " active" : "")}
            title="Narx bu darajadan pastga tushsa ogohlantir"
            onClick={() => setDir("below")}
          >
            <ArrowDown size={11} /> Pastda
          </button>
        </div>

        <div className="alerts-price-row">
          <input
            className={error ? "alerts-input bad" : "alerts-input"}
            type="number"
            min={0}
            step={Math.pow(10, -digits)}
            value={priceText}
            placeholder="Narx"
            aria-label="Alert narxi"
            onChange={(event) => {
              setPriceText(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <span className="alerts-sym-tag">{symbol}</span>
        </div>

        <input
          className="alerts-input alerts-note"
          value={noteText}
          placeholder="Izoh (ixtiyoriy)"
          aria-label="Alert izohi"
          maxLength={120}
          onChange={(event) => setNoteText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />

        <div className="alerts-form-foot">
          <span className="alerts-now">Joriy: {isFinite(mid) ? mid.toFixed(digits) : "—"}</span>
          <span className="alerts-error">{error}</span>
          <button type="button" className="alerts-add" onClick={submit}>
            {"Qo'shish"}
          </button>
        </div>
      </div>

      <div className="alerts-list">
        {alerts.length === 0 ? (
          <div className="alerts-empty">Hozircha alert yo'q</div>
        ) : (
          alerts.map((alert) => {
            const entry = quotes[alert.symbol];
            const liveMid = entry && isFinite(entry.mid) ? entry.mid : NaN;
            const metaEntry = metaBySymbol.get(alert.symbol);
            const point =
              metaEntry && isFinite(metaEntry.point) && metaEntry.point > 0
                ? metaEntry.point
                : Math.pow(10, -alert.digits);
            const pips = alert.active ? pipDistance(alert.price, liveMid, point) : null;
            const className =
              "alerts-row" +
              (alert.triggeredAt !== null ? " fired" : alert.active ? " armed" : " paused") +
              (alert.dir === "below" ? " below" : "");
            return (
              <div key={alert.id} className={className}>
                <div className="alerts-row-top">
                  <span className="alerts-row-sym">{alert.symbol}</span>
                  <span className={"alerts-cond " + (alert.dir === "above" ? "up" : "down")}>
                    {alert.dir === "above" ? "↑ yuqorida " : "↓ pastda "}
                    {alert.price.toFixed(alert.digits)}
                  </span>
                  <span className="alerts-row-pips">{pips !== null ? pips + " pip" : ""}</span>
                </div>
                <div className="alerts-row-bottom">
                  <span className="alerts-row-note">{alert.note}</span>
                  <span className="alerts-row-actions">
                    {alert.triggeredAt !== null ? (
                      <span className="alerts-row-time" title="Ishga tushgan vaqt">
                        {hhmm(alert.triggeredAt)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={alert.active ? "alerts-switch on" : "alerts-switch"}
                      title={alert.active ? "Vaqtincha o'chirish" : "Qayta yoqish"}
                      aria-pressed={alert.active}
                      onClick={() => toggle(alert.id)}
                    >
                      {alert.active ? "faol" : "o'chiq"}
                    </button>
                    <button
                      type="button"
                      className="alerts-del"
                      title="Alertni o'chirish"
                      aria-label="Alertni o'chirish"
                      onClick={() => remove(alert.id)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="alerts-foot">
        <span className="alerts-help">Brauzerda saqlanadi</span>
        <button
          type="button"
          className="alerts-clear"
          disabled={firedCount === 0}
          title="Ishga tushgan alertlarni ro'yxatdan olib tashlash"
          onClick={clearTriggered}
        >
          Ishlaganlarini tozalash
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Tashqi komponent: watcher + toastlar. Panel yopiq bo'lsa ham mount holatda */
/* qoladi, shuning uchun alertlar istalgan symbol uchun ishlaydi.            */
/* ------------------------------------------------------------------------ */
export default function AlertsPanel() {
  const open = useAlerts((s) => s.open);
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const unsubscribe = useTerminal.subscribe((state, prev) => {
      if (state.quotes === prev.quotes) return;
      const { alerts, sound } = useAlerts.getState();
      if (!alerts.length) return;

      const hits: { alert: PriceAlert; mid: number }[] = [];
      const toPrime: string[] = [];
      for (const alert of alerts) {
        if (!alert.active) continue;
        const quote = state.quotes[alert.symbol];
        if (!quote || !isFinite(quote.mid)) continue;
        const satisfied = alert.dir === "above" ? quote.mid >= alert.price : quote.mid <= alert.price;
        if (!alert.primed) {
          // Narx shartdan chiqib ketgach alert "qurollanadi" — darhol emas,
          // keyingi kesib o'tishda ishlaydi (TradingView'dagi crossing kabi).
          if (!satisfied) toPrime.push(alert.id);
          continue;
        }
        if (satisfied) hits.push({ alert, mid: quote.mid });
      }
      if (toPrime.length) {
        const primeIds = new Set(toPrime);
        useAlerts.setState((current) => ({
          alerts: current.alerts.map((alert) => (primeIds.has(alert.id) ? { ...alert, primed: true } : alert)),
        }));
      }
      if (!hits.length) return;

      const at = Date.now();
      const firedIds = new Set(hits.map((item) => item.alert.id));
      // Triggered alertlar ro'yxat boshiga ko'chadi va bir marta belgilanadi.
      useAlerts.setState((current) => ({
        alerts: hits
          .map((item): PriceAlert => ({ ...item.alert, active: false, triggeredAt: at }))
          .concat(current.alerts.filter((alert) => !firedIds.has(alert.id))),
      }));

      if (sound) beep();

      const fresh: AlertToast[] = [];
      for (const item of hits) {
        toastSeq += 1;
        fresh.push({ id: "t" + toastSeq, alert: item.alert, mid: item.mid, at });
        notify(item.alert, item.mid);
      }
      fresh.forEach((toast) => {
        const timer = window.setTimeout(() => {
          setToasts((current) => current.filter((entry) => entry.id !== toast.id));
        }, TOAST_MS);
        timers.current.push(timer);
      });
      setToasts((current) => fresh.concat(current).slice(0, MAX_TOASTS));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // StrictMode ikki marta mount qiladi — timerlar unmount'da tozalanadi.
  useEffect(() => {
    const list = timers;
    return () => {
      list.current.forEach((id) => window.clearTimeout(id));
      list.current = [];
    };
  }, []);

  if (!open && toasts.length === 0) return null;

  return (
    <>
      {open ? <AlertsBody /> : null}
      {toasts.length ? (
        <div className="alerts-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              className={"alerts-toast" + (toast.alert.dir === "below" ? " below" : "")}
              title="Alertlar panelini ochish"
              onClick={() => {
                useAlerts.getState().setOpen(true);
                setToasts((current) => current.filter((entry) => entry.id !== toast.id));
              }}
            >
              <span className="alerts-toast-top">
                <Bell size={11} />
                <span className="alerts-toast-sym">{toast.alert.symbol}</span>
                <span className="alerts-toast-arrow">{toast.alert.dir === "above" ? "↑" : "↓"}</span>
                <span className="alerts-toast-price">{toast.alert.price.toFixed(toast.alert.digits)}</span>
                <span className="alerts-toast-time">{hhmmss(toast.at)}</span>
              </span>
              <span className="alerts-toast-body">
                {toast.alert.note ? toast.alert.note : "Narx " + toast.mid.toFixed(toast.alert.digits) + " ga yetdi"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
