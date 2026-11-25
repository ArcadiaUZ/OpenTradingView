import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  Gauge,
  Pause,
  Play,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import { pad2 } from "../lib/format";
import { REPLAY_SPEEDS, useReplay } from "../lib/replay";
import { useTerminal } from "../store";

const CLOCK_FMT = new Intl.DateTimeFormat("uz-UZ", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

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

/** Faol replay boshqaruvi: chart ustida suzuvchi pill. */
export default function ReplayControls() {
  const active = useReplay((s) => s.active);
  const symbol = useReplay((s) => s.symbol);
  const tf = useReplay((s) => s.tf);
  const cursor = useReplay((s) => s.cursor);
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const loading = useReplay((s) => s.loading);
  const toggle = useReplay((s) => s.toggle);
  const step = useReplay((s) => s.step);
  const setSpeed = useReplay((s) => s.setSpeed);
  const stop = useReplay((s) => s.stop);

  const [menu, setMenu] = useState<"speed" | "jump" | null>(null);
  const [jumpValue, setJumpValue] = useState("");

  // Replay tugasa, ochiq menyu qolib ketmasin.
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  // Menyu/jump panel tashqarisiga bosilganda (yoki Esc) yopiladi.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest(".replay-controls")) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!active) return null;

  const clock = cursor === null ? "…" : CLOCK_FMT.format(new Date(cursor * 1000));

  const openJump = () => {
    const at = cursor === null ? Date.now() : cursor * 1000;
    setJumpValue(toLocalInput(new Date(at)));
    setMenu(menu === "jump" ? null : "jump");
  };

  const doJump = () => {
    const ms = new Date(jumpValue).getTime();
    if (!Number.isFinite(ms)) return;
    void useReplay.getState().jump(ms / 1000);
    setMenu(null);
  };

  const exitReplay = () => {
    stop();
    useTerminal.getState().pushToast("Replay tugadi");
  };

  return (
    <div
      className={loading ? "replay-controls loading" : "replay-controls"}
      data-testid="replay-controls"
      role="toolbar"
      aria-label="Replay boshqaruvi"
    >
      {playing ? <span className="replay-live" title="O'ynalmoqda" aria-hidden="true" /> : null}
      <span className="replay-symbol">
        {symbol} · {tf}
      </span>
      <span className="replay-clock" title="Joriy replay vaqti">
        {clock}
      </span>
      {loading ? (
        <span className="replay-loading">
          <span className="replay-spinner" aria-hidden="true" />
          yuklanmoqda…
        </span>
      ) : null}

      <span className="replay-sep" aria-hidden="true" />

      <button
        type="button"
        className="replay-btn"
        data-action="back"
        title="1 sham orqaga"
        aria-label="1 sham orqaga"
        onClick={() => {
          void step(-1);
        }}
      >
        <StepBack size={14} />
      </button>

      <button
        type="button"
        className={playing ? "replay-btn replay-play on" : "replay-btn replay-play"}
        data-action="play"
        title="O'ynatish/To'xtatish"
        aria-label={playing ? "To'xtatish" : "O'ynatish"}
        aria-pressed={playing}
        onClick={toggle}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <button
        type="button"
        className="replay-btn"
        data-action="fwd"
        title="1 sham oldinga"
        aria-label="1 sham oldinga"
        onClick={() => {
          void step(1);
        }}
      >
        <StepForward size={14} />
      </button>

      <span className="replay-sep" aria-hidden="true" />

      <button
        type="button"
        className="replay-btn replay-speed"
        data-action="speed"
        title="Tezlik"
        aria-haspopup="menu"
        aria-expanded={menu === "speed"}
        onClick={() => setMenu(menu === "speed" ? null : "speed")}
      >
        <Gauge size={13} />
        <span className="replay-speed-value">{speed}x</span>
        <ChevronDown size={11} />
      </button>

      <button
        type="button"
        className="replay-btn"
        data-action="jump"
        title="Sanaga o'tish"
        aria-label="Sanaga o'tish"
        aria-haspopup="dialog"
        aria-expanded={menu === "jump"}
        onClick={openJump}
      >
        <CalendarClock size={14} />
      </button>

      <span className="replay-sep" aria-hidden="true" />

      <button
        type="button"
        className="replay-btn replay-exit"
        data-action="exit"
        title="Replaydan chiqish"
        aria-label="Replaydan chiqish"
        onClick={exitReplay}
      >
        <X size={14} />
      </button>

      {menu === "speed" ? (
        <div className="replay-menu" role="menu" aria-label="Replay tezligi">
          {REPLAY_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === speed ? "replay-menu-item active" : "replay-menu-item"}
              data-speed={String(option)}
              role="menuitemradio"
              aria-checked={option === speed}
              onClick={() => {
                setSpeed(option);
                setMenu(null);
              }}
            >
              <span>{option}x</span>
              {option === speed ? <span className="replay-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {menu === "jump" ? (
        <div className="replay-jump-pop">
          <input
            type="datetime-local"
            className="replay-jump-input"
            value={jumpValue}
            aria-label="Sanaga o'tish"
            autoFocus
            onChange={(event) => setJumpValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") doJump();
            }}
          />
          <button type="button" className="replay-jump-go" data-action="jump-go" onClick={doJump}>
            {"O'tish"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
