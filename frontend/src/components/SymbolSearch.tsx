import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTerminal } from "../store";

export default function SymbolSearch() {
  const symbols = useTerminal((s) => s.symbols);
  const setSymbol = useTerminal((s) => s.setSymbol);
  const setSearchOpen = useTerminal((s) => s.setSearchOpen);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const needle = query.trim().toLowerCase();
  const results = symbols.filter((item) => {
    if (!needle) return true;
    return (item.symbol + " " + item.name).toLowerCase().indexOf(needle) >= 0;
  });

  const choose = (code: string) => setSymbol(code);

  return (
    <div className="search-backdrop" onMouseDown={() => setSearchOpen(false)}>
      <div className="search-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="search-head">
          <Search size={15} />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search symbol..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results.length > 0) choose(results[0].symbol);
              if (event.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="search-hint">Ctrl+K</span>
        </div>
        <div className="search-list">
          {results.map((item) => (
            <button key={item.symbol} className="search-row" onClick={() => choose(item.symbol)}>
              <span className="search-sym">{item.symbol}</span>
              <span className="search-name">{item.name}</span>
              <span className="search-kind">{item.kind === "metal" ? "Metals" : "Forex"}</span>
            </button>
          ))}
          {results.length === 0 ? <div className="search-empty">No matches</div> : null}
        </div>
      </div>
    </div>
  );
}
