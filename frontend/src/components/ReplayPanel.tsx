import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TF_SECONDS, pad2, utcOffsetLabel } from "../lib/format";
import { useReplay, useReplayUI } from "../lib/replay";
import { useTerminal } from "../store";

type Preset = { id: string; label: string; days?: number; months?: number };

const PRESETS: Preset[] = [
  { id: "1d", label: "1 kun", days: 1 },
  { id: "3d", label: "3 kun", days: 3 },
  { id: "1w", label: "1 hafta", days: 7 },
  { id: "2w", label: "2 hafta", days: 14 },
  { id: "1m", label: "1 oy", months: 1 },
  { id: "3m", label: "3 oy", months: 3 },
];

/** Date -> datetime-local qiymati (lokal timezone, "YYYY-MM-DDTHH:mm"). */
function toLocalInput(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate()) +
    "T" +
    pad2(date.getHours()) +
    ":" +
    pad2(date.getMinutes())
  );
}

function presetDate(preset: Preset): Date {
  const date = new Date();
  if (preset.months) date.setMonth(date.getMonth() - preset.months);
  if (preset.days) date.setDate(date.getDate() - preset.days);
  return date;
}

/** Boshlash dialogi: sana tanlash + replay start / jump. */
function ReplayDialog() {
  const setOpen = useReplayUI((s) => s.setOpen);
  const symbol = useTerminal((s) => s.symbol);
  const tf = useTerminal((s) => s.tf);
  const active = useReplay((s) => s.active);
  const loading = useReplay((s) => s.loading);

  const [value, setValue] = useState(() => toLocalInput(presetDate(PRESETS[1])));
  const [presetId, setPresetId] = useState<string | null>("3d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const applyPreset = (preset: Preset) => {
    setValue(toLocalInput(presetDate(preset)));
    setPresetId(preset.id);
    setError(null);
  };

  const run = async () => {
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) {
      setError("Sana noto'g'ri");
      return;
    }
    const ts = Math.floor(parsed / 1000);
    setError(null);
    const replay = useReplay.getState();
    if (replay.active) {
      await replay.jump(ts);
      setOpen(false);
      return;
    }
    const ok = await replay.start(ts);
    if (ok) {
      setOpen(false);
      useTerminal.getState().pushToast("Replay boshlandi");
      return;
    }
    setError(useReplay.getState().error || "Boshlab bo'lmadi");
  };

  const step = TF_SECONDS[tf] || 60;
  const startLabel = loading
    ? "Tarix yuklanmoqda…"
    : active
      ? "O'sha sanaga o'tish"
      : "Replayni boshlash";

  return (
    <div className="replay-modal" onPointerDown={() => setOpen(false)}>
      <div
        className="replay-card"
        data-testid="replay-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Bar Replay"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="replay-head">
          <span className="replay-title">Bar Replay — backtesting</span>
          <button
            type="button"
            className="replay-close"
            title="Yopish (Esc)"
            aria-label="Yopish (Esc)"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <p className="replay-note">
          Narxlar MT5'dan avtomatik yuklanadi — fayl import qilish shart emas. Replay paytida timeframe
          yoki instrument almashsangiz ham kursor joyida qoladi.
        </p>

        <div className="replay-instrument">
          {symbol} · {tf}
        </div>

        <div className="replay-presets" role="group" aria-label="Tez tanlash">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={presetId === preset.id ? "replay-preset active" : "replay-preset"}
              data-preset={preset.id}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <label className="replay-field">
          <span className="replay-label">Boshlanish vaqti (mahalliy)</span>
          <input
            type="datetime-local"
            className="replay-datetime"
            value={value}
            step={step}
            onChange={(event) => {
              setValue(event.target.value);
              setPresetId(null);
              setError(null);
            }}
          />
        </label>

        {error ? (
          <div className="replay-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="replay-foot">
          <span className="replay-hint">Mahalliy vaqt · {utcOffsetLabel()}</span>
          <button
            type="button"
            className="replay-start"
            disabled={loading}
            onClick={() => {
              void run();
            }}
          >
            {startLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReplayPanel() {
  const open = useReplayUI((s) => s.open);
  if (!open) return null;
  return <ReplayDialog />;
}
