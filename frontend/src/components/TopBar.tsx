import {
  Bell,
  Camera,
  ChevronDown,
  LayoutGrid,
  Maximize2,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { openAlerts, useAlerts } from "../lib/alerts";
import { TF_LABEL, TF_LIST } from "../lib/format";
import { saveLayout } from "../lib/layout";
import { openTrade } from "../lib/paper";
import { useTerminal, type ChartType, type IndicatorKey } from "../store";

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "candles", label: "Shamlar" },
  { id: "bars", label: "Bar (OHLC)" },
  { id: "line", label: "Chiziq" },
  { id: "area", label: "Area" },
];

const INDICATORS: { id: IndicatorKey; label: string }[] = [
  { id: "ema20", label: "EMA 20" },
  { id: "ema50", label: "EMA 50" },
  { id: "sma200", label: "SMA 200" },
  { id: "bb", label: "Bollinger (20, 2)" },
];

function offsetLabel(seconds: number): string {
  const sign = seconds >= 0 ? "+" : "-";
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return "UTC" + sign + h + (m ? ":" + String(m).padStart(2, "0") : "");
}

export default function TopBar() {
  const symbol = useTerminal((s) => s.symbol);
  const tf = useTerminal((s) => s.tf);
  const status = useTerminal((s) => s.status);
  const socketOpen = useTerminal((s) => s.socketOpen);
  const watchlistOpen = useTerminal((s) => s.watchlistOpen);
  const symbols = useTerminal((s) => s.symbols);
  const serverOffset = useTerminal((s) => s.serverOffset);
  const chartType = useTerminal((s) => s.chartType);
  const indicators = useTerminal((s) => s.indicators);
  const setTf = useTerminal((s) => s.setTf);
  const setSearchOpen = useTerminal((s) => s.setSearchOpen);
  const toggleWatchlist = useTerminal((s) => s.toggleWatchlist);
  const setChartType = useTerminal((s) => s.setChartType);
  const toggleIndicator = useTerminal((s) => s.toggleIndicator);
  const setSettingsOpen = useTerminal((s) => s.setSettingsOpen);
  const pushToast = useTerminal((s) => s.pushToast);
  const activeAlerts = useAlerts((s) => s.alerts.filter((alert) => alert.active).length);
  const [menu, setMenu] = useState<null | "type" | "ind" | "account">(null);
  const live = socketOpen && status && status.live;

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest(".menu")) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [menu]);

  const snapshot = () => {
    const chart = (window as any).__chart;
    if (!chart || typeof chart.takeScreenshot !== "function") {
      pushToast("Chart hali tayyor emas");
      return;
    }
    try {
      const canvas = chart.takeScreenshot() as HTMLCanvasElement;
      const link = document.createElement("a");
      canvas.toBlob((blob) => {
        if (!blob) return;
        link.href = URL.createObjectURL(blob);
        link.download = symbol + "-" + tf + "-" + Date.now() + ".png";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      }, "image/png");
      pushToast("Snapshot yuklab olindi");
    } catch (err) {
      pushToast("Snapshot olishda xatolik");
    }
  };

  const toggleFullscreen = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen().catch(() => pushToast("Fullscreen ochilmadi"));
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">T</span>
      </div>

      <button className="symbol-button" onClick={() => setSearchOpen(true)} title="Search symbol (Ctrl+K)">
        <Search size={13} className="symbol-icon" />
        <span className="symbol-code">{symbol}</span>
        <ChevronDown size={13} />
      </button>

      <div className="tf-group">
        {TF_LIST.map((item) => (
          <button key={item} className={item === tf ? "tf active" : "tf"} onClick={() => setTf(item)}>
            {TF_LABEL[item]}
          </button>
        ))}
      </div>

      <div className="bar-sep" />

      <div className="icon-group">
        <div className="menu-anchor">
          <button className={menu === "type" ? "icon-btn on" : "icon-btn"} title="Chart turi" onClick={() => setMenu(menu === "type" ? null : "type")}>
            <LayoutGrid size={16} />
          </button>
          {menu === "type" ? (
            <div className="menu">
              <div className="menu-title">Chart turi</div>
              {CHART_TYPES.map((item) => (
                <button
                  key={item.id}
                  className="menu-item"
                  onClick={() => {
                    setChartType(item.id);
                    setMenu(null);
                  }}
                >
                  {item.label}
                  {chartType === item.id ? <span className="check">&#10003;</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="menu-anchor">
          <button className={menu === "ind" ? "icon-btn on" : "icon-btn"} title="Indikatorlar" onClick={() => setMenu(menu === "ind" ? null : "ind")}>
            <SlidersHorizontal size={16} />
          </button>
          {menu === "ind" ? (
            <div className="menu">
              <div className="menu-title">Indikatorlar</div>
              {INDICATORS.map((item) => (
                <button key={item.id} className="menu-item" onClick={() => toggleIndicator(item.id)}>
                  {item.label}
                  {indicators[item.id] ? <span className="check">&#10003;</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          className={activeAlerts > 0 ? "icon-btn has-badge" : "icon-btn"}
          title="Alertlar"
          onClick={() => openAlerts()}
        >
          <Bell size={16} />
          {activeAlerts > 0 ? <span className="badge">{activeAlerts}</span> : null}
        </button>
      </div>

      <div className="bar-sep" />

      <button className={watchlistOpen ? "icon-btn on" : "icon-btn"} title="Watchlist" onClick={toggleWatchlist}>
        <span className="wl-glyph">WL</span>
      </button>

      <div className="spacer" />

      <button
        className="save-group"
        title="Layoutni saqlash"
        onClick={() => {
          saveLayout();
          pushToast("Layout saqlandi");
        }}
      >
        <span className="save-name">Terminal</span>
        <span className="save-hint">Save</span>
      </button>

      <div className="icon-group">
        <button className="icon-btn" title="Sozlamalar" onClick={() => setSettingsOpen(true)}>
          <Settings size={16} />
        </button>
        <button className="icon-btn" title="Fullscreen" onClick={toggleFullscreen}>
          <Maximize2 size={16} />
        </button>
        <button className="icon-btn" title="Snapshot (PNG)" onClick={snapshot}>
          <Camera size={16} />
        </button>
        <button
          className="icon-btn"
          title="Layoutni saqlash"
          onClick={() => {
            saveLayout();
            pushToast("Layout saqlandi");
          }}
        >
          <Save size={16} />
        </button>
      </div>

      <button className="trade-button" onClick={() => openTrade()}>
        Trade
      </button>

      <div className="menu-anchor">
        <button className="account-button" title="MT5 ulanish holati" onClick={() => setMenu(menu === "account" ? null : "account")}>
          <span className={live ? "dot live" : "dot"} />
          <span>MT5</span>
          <ChevronDown size={12} />
        </button>
        {menu === "account" ? (
          <div className="status-pop">
            <div className="status-head">
              <span className={live ? "dot live" : "dot"} />
              <span>MetaTrader 5</span>
            </div>
            <div className="status-row">
              <span>Server</span>
              <b>EXNESS</b>
            </div>
            <div className="status-row">
              <span>Ulanish</span>
              <b className={socketOpen ? "ok" : "bad"}>{socketOpen ? "WebSocket OK" : "Uzilgan"}</b>
            </div>
            <div className="status-row">
              <span>Feed</span>
              <b className={status && status.live ? "ok" : "bad"}>{status && status.live ? "LIVE" : "OFF"}</b>
            </div>
            <div className="status-row">
              <span>Server vaqti</span>
              <b>{offsetLabel(serverOffset)}</b>
            </div>
            <div className="status-row">
              <span>Instrumentlar</span>
              <b>{symbols.length}</b>
            </div>
            <div className="status-row">
              <span>Uptime</span>
              <b>{status ? Math.round(status.uptime) + "s" : "-"}</b>
            </div>
            <div className="status-row">
              <span>Yangilanish</span>
              <b>0.3s</b>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
