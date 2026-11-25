import { useEffect } from "react";
import TopBar from "./components/TopBar";
import LeftRail from "./components/LeftRail";
import ChartPanel from "./components/ChartPanel";
import Watchlist from "./components/Watchlist";
import SymbolSearch from "./components/SymbolSearch";
import BottomBar from "./components/BottomBar";
import SettingsDialog from "./components/SettingsDialog";
import Toast from "./components/Toast";
import AlertsPanel from "./components/AlertsPanel";
import TradePanel from "./components/TradePanel";
import ReplayPanel from "./components/ReplayPanel";
import ReplayControls from "./components/ReplayControls";
import { feedClient } from "./lib/feed";
import { TF_SECONDS } from "./lib/format";
import { loadLayout, saveLayout } from "./lib/layout";
import { startReplayTimer, useReplay, useReplayUI } from "./lib/replay";
import { useTerminal } from "./store";

export default function App() {
  const symbol = useTerminal((s) => s.symbol);
  const tf = useTerminal((s) => s.tf);
  const socketOpen = useTerminal((s) => s.socketOpen);
  const watchlistOpen = useTerminal((s) => s.watchlistOpen);
  const searchOpen = useTerminal((s) => s.searchOpen);

  useEffect(() => {
    loadLayout();
  }, []);

  // Replay taymeri — o'ynatish tezligi bo'yicha bar-bar oldinga suradi.
  useEffect(() => startReplayTimer(), []);

  // Replay paytida timeframe almashsa: kursor saqlanadi, faqat ma'lumot qayta yuklanadi.
  useEffect(() => {
    const replay = useReplay.getState();
    if (!replay.active) return;
    if (replay.tf !== tf) void replay.loadTf(tf);
  }, [tf]);

  // Replay paytida instrument almashsa: kursor saqlanadi.
  useEffect(() => {
    const replay = useReplay.getState();
    if (!replay.active) return;
    if (replay.symbol !== symbol) void replay.bindSymbol(symbol);
  }, [symbol]);

  useEffect(() => {
    if (!socketOpen) return;
    feedClient.subscribe(symbol, tf, 1500);
    return () => {
      feedClient.unsubscribe(symbol, tf);
    };
  }, [symbol, tf, socketOpen]);

  // Auto-save the layout (symbol, timeframe, chart type, indicators, settings).
  useEffect(() => {
    let timer = 0;
    const unsub = useTerminal.subscribe((state, prev) => {
      if (
        state.symbol === prev.symbol &&
        state.tf === prev.tf &&
        state.chartType === prev.chartType &&
        state.indicators === prev.indicators &&
        state.settings === prev.settings
      ) {
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => saveLayout(), 600);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);

  // Watchdog: if candles stop arriving (dropped subscription, sleep, reconnect bug),
  // re-subscribe so the chart can never silently freeze behind the live price tag.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const state = useTerminal.getState();
      if (!state.socketOpen || !state.status || !state.status.live) return;
      const bars = state.data ? state.data.bars : [];
      if (!bars.length) return;
      const last = bars[bars.length - 1].time;
      const seconds = TF_SECONDS[state.tf] || 60;
      const age = Math.floor(Date.now() / 1000) - last;
      if (age > Math.max(seconds * 3, 180)) {
        feedClient.subscribe(state.symbol, state.tf, 1500);
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useTerminal.getState().setSearchOpen(true);
      }
      if (event.key === "Escape") {
        useTerminal.getState().setSearchOpen(false);
        useTerminal.getState().setSettingsOpen(false);
        useReplayUI.getState().setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LeftRail />
        <div className="chart-area">
          <ChartPanel />
        </div>
        {watchlistOpen ? <Watchlist /> : null}
      </div>
      <BottomBar />
      {searchOpen ? <SymbolSearch /> : null}
      <SettingsDialog />
      <AlertsPanel />
      <TradePanel />
      <ReplayPanel />
      <ReplayControls />
      <Toast />
    </div>
  );
}
