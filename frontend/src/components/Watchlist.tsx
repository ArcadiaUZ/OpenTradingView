import { Plus, Search } from "lucide-react";
import { fmtChangePct, fmtPrice } from "../lib/format";
import { useTerminal } from "../store";

export default function Watchlist() {
  const symbols = useTerminal((s) => s.symbols);
  const quotes = useTerminal((s) => s.quotes);
  const baseline = useTerminal((s) => s.baseline);
  const active = useTerminal((s) => s.symbol);
  const selected = useTerminal((s) => s.symbol);
  const setSymbol = useTerminal((s) => s.setSymbol);
  const setSearchOpen = useTerminal((s) => s.setSearchOpen);

  return (
    <aside className="watchlist">
      <div className="wl-head">
        <span className="wl-title">Watchlist</span>
        <button className="icon-btn tiny" title="Add symbol" onClick={() => setSearchOpen(true)}>
          <Plus size={14} />
        </button>
      </div>
      <div className="wl-cols">
        <span>Symbol</span>
        <span>Last</span>
        <span>Chg</span>
      </div>
      <div className="wl-rows">
        {symbols.map((item) => {
          const quote = quotes[item.symbol];
          const mid = quote ? quote.mid : 0;
          const base = baseline[item.symbol] || mid;
          const change = base ? ((mid - base) / base) * 100 : 0;
          const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
          return (
            <button
              key={item.symbol}
              className={item.symbol === selected ? "wl-row active" : "wl-row"}
              onClick={() => setSymbol(item.symbol)}
            >
              <span className="wl-sym">{item.symbol}</span>
              <span className={dir === "up" ? "wl-price up" : dir === "down" ? "wl-price down" : "wl-price"}>
                {mid ? fmtPrice(mid, item.digits) : "-"}
              </span>
              <span className={dir === "up" ? "wl-chg up" : dir === "down" ? "wl-chg down" : "wl-chg"}>
                {fmtChangePct(change)}
              </span>
            </button>
          );
        })}
        {symbols.length === 0 ? (
          <div className="wl-empty">
            <Search size={14} /> Connecting to feed...
          </div>
        ) : null}
      </div>
      <div className="wl-foot">MT5 · 0.3s</div>
    </aside>
  );
}
