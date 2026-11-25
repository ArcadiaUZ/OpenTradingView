import { ArrowLeftRight, ChevronLeft, ChevronRight, History } from "lucide-react";
import { useEffect, useState } from "react";
import { localHms, utcOffsetLabel } from "../lib/format";
import { applyRange, RANGE_PRESETS } from "../lib/ranges";
import { openReplayPanel, useReplay } from "../lib/replay";
import { useTerminal } from "../store";

export default function BottomBar() {
  const clockTs = useTerminal((s) => s.clockTs);
  const socketOpen = useTerminal((s) => s.socketOpen);
  const status = useTerminal((s) => s.status);
  const symbol = useTerminal((s) => s.symbol);
  const tf = useTerminal((s) => s.tf);
  const loadingRange = useTerminal((s) => s.loadingRange);
  const sendChartCmd = useTerminal((s) => s.sendChartCmd);
  const replayActive = useReplay((s) => s.active);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    setActive(null);
  }, [symbol, tf]);

  return (
    <footer className="bottombar">
      <button
        className={replayActive ? "icon-btn tiny replay-launch active" : "icon-btn tiny replay-launch"}
        title="Bar Replay — tarixni bar-bar o'ynatib backtest qilish"
        onClick={openReplayPanel}
      >
        <History size={13} />
      </button>
      <button className="icon-btn tiny" title="Orqaga surish" onClick={() => sendChartCmd("panLeft")}>
        <ChevronLeft size={13} />
      </button>
      <button className="icon-btn tiny" title="Oldinga surish" onClick={() => sendChartCmd("panRight")}>
        <ChevronRight size={13} />
      </button>
      {replayActive ? (
        <span className="replay-mode-label" title="Replay paytida davr tugmalari o'chirilgan">
          REPLAY
        </span>
      ) : (
      <div className="range-group">
        {RANGE_PRESETS.map((range) => (
          <button
            key={range}
            className={range === active ? "range active" : "range"}
            title={range === "All" ? "Barcha yuklangan tarix" : range + " davr"}
            onClick={() => {
              setActive(range);
              void applyRange(range);
            }}
          >
            {loadingRange === range ? "…" : range}
          </button>
        ))}
      </div>
      )}
      <button className="icon-btn tiny" title="Realtime ga qaytish" onClick={() => sendChartCmd("realtime")}>
        <ArrowLeftRight size={13} />
      </button>

      <div className="spacer" />

      <span className={socketOpen ? "feed-state live" : "feed-state"}>
        {socketOpen ? (status && status.live ? "LIVE FEED" : "CONNECTED") : "OFFLINE"}
      </span>
      <span className="clock">{localHms(clockTs)}</span>
      <span className="tz">{utcOffsetLabel()}</span>
    </footer>
  );
}
