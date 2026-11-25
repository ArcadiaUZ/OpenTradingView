import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, Wallet, X } from "lucide-react";
import { fmtPrice, pad2 } from "../lib/format";
import type { Quote } from "../lib/types";
import { useTerminal } from "../store";
import {
  PAPER_START_BALANCE,
  clampLots,
  positionPnl,
  usePaper,
  usePaperUI,
} from "../lib/paper";
import type { Position, Side } from "../lib/paper";
import { replayLastBar, replayMid, replaySpread, useReplay } from "../lib/replay";
import "./trade.css";

/* ---------------------------------------------------------------- helpers */

type Level = number | null | "invalid";

function readLevel(text: string): Level {
  const raw = text.trim().replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : "invalid";
}

function digitsFor(symbol: string): number {
  const code = symbol.toUpperCase();
  if (code.indexOf("XAU") === 0) return 2;
  if (code.endsWith("JPY")) return 3;
  return 5;
}

function fmtUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return "$" + safe.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSigned(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe > 0 ? "+" : "";
  return sign + safe.toFixed(2);
}

function pnlClass(value: number): string {
  if (value > 0) return "pp-gain";
  if (value < 0) return "pp-loss";
  return "pp-flat";
}

function hhmm(ts: number): string {
  const date = new Date(ts);
  return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}

/* -------------------------------------------------------------- component */

export function TradePanel() {
  const symbol = useTerminal((state) => state.symbol);
  const meta = useTerminal((state) => state.meta);
  const quotes = useTerminal((state) => state.quotes);

  // Replay store'iga obuna: cursor har shamda o'zgaradi -> PnL ham yangilanadi.
  const replayActive = useReplay((state) => state.active);
  const replaySymbol = useReplay((state) => state.symbol);
  const replayCursor = useReplay((state) => state.cursor);

  const open = usePaperUI((state) => state.open);
  const selectedSide = usePaperUI((state) => state.side);
  const setSide = usePaperUI((state) => state.setSide);
  const closePanel = usePaperUI((state) => state.closePanel);

  const balance = usePaper((state) => state.balance);
  const lots = usePaper((state) => state.lots);
  const positions = usePaper((state) => state.positions);
  const history = usePaper((state) => state.history);
  const setLots = usePaper((state) => state.setLots);
  const closePosition = usePaper((state) => state.close);
  const closeAll = usePaper((state) => state.closeAll);
  const resetPaper = usePaper((state) => state.reset);

  const [lotsText, setLotsText] = useState(() => lots.toFixed(2));
  const [slText, setSlText] = useState("");
  const [tpText, setTpText] = useState("");
  const [error, setError] = useState("");

  const quote: Quote | undefined = quotes[symbol];
  /** Replay faol va aynan shu instrument replay qilinayotgan bo'lsa. */
  const inReplay = replayActive && replaySymbol === symbol;
  const replayPrice = inReplay ? replayMid(symbol) : null;

  let bid = quote && Number.isFinite(quote.bid) ? quote.bid : 0;
  let ask = quote && Number.isFinite(quote.ask) ? quote.ask : 0;
  let ready = bid > 0 && ask > 0;

  // Replay paytida BID/ASK kursor narxidan va jonli spread approksimatsiyasidan olinadi.
  if (inReplay && replayPrice !== null && Number.isFinite(replayPrice) && replayPrice > 0) {
    const spread = replaySpread(symbol);
    bid = replayPrice - spread / 2;
    ask = replayPrice + spread / 2;
    ready = true;
  }

  const digits = meta && meta.symbol === symbol ? meta.digits : digitsFor(symbol);

  const replayTimeLabel =
    replayCursor !== null
      ? new Date(replayCursor * 1000).toLocaleString("uz-UZ", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  /**
   * Bitta pozitsiya uchun joriy narx.
   * Replay paytida replay instrumentining narxi — replay kursorining close'i;
   * boshqa instrumentlar (va replay o'chganda) jonli quote mid.
   * Narx umuman bo'lmasa — kirish narxi (PnL 0 bo'lib qoladi).
   */
  const currentPriceFor = (position: Position): number => {
    if (replayActive && position.symbol === replaySymbol) {
      const value = replayMid(position.symbol);
      if (value !== null && Number.isFinite(value) && value > 0) return value;
      return position.entry;
    }
    const current = quotes[position.symbol];
    if (current && Number.isFinite(current.mid) && current.mid > 0) return current.mid;
    return position.entry;
  };

  const floating = positions.reduce(
    (total, position) => total + positionPnl(position, currentPriceFor(position)),
    0
  );
  const equity = balance + floating;

  // Oxirgi ko'rilgan replay narxi (replay tugaganda shu narxda yopamiz).
  const lastReplayMidRef = useRef<{ symbol: string; price: number } | null>(null);
  const wasReplayActiveRef = useRef(replayActive);
  const prevCursorRef = useRef<number | null>(null);

  // Har renderda oxirgi replay narxini yodda tutamiz.
  useEffect(() => {
    if (!inReplay) return;
    if (replayPrice === null || !Number.isFinite(replayPrice) || replayPrice <= 0) return;
    lastReplayMidRef.current = { symbol, price: replayPrice };
  }, [inReplay, replayPrice, symbol]);

  // Replay tugadi (active true -> false): ochiq replay pozitsiyalarini oxirgi
  // replay narxida yopamiz — aks holda ular jonli narxda "osilib" qoladi.
  useEffect(() => {
    const wasActive = wasReplayActiveRef.current;
    wasReplayActiveRef.current = replayActive;
    if (!wasActive || replayActive) return;
    prevCursorRef.current = null;
    const snapshot = lastReplayMidRef.current;
    lastReplayMidRef.current = null;
    if (!snapshot) return;
    const paper = usePaper.getState();
    const opened = paper.positions.filter((position) => position.symbol === snapshot.symbol);
    if (!opened.length) return;
    // closeAll() hamma pozitsiyani yopadi: replay instrumenti oxirgi replay narxida,
    // boshqa instrumentlar o'z jonli quote mid'ida yopiladi (entry'da emas).
    const prices: Record<string, number> = {};
    for (const position of paper.positions) {
      if (prices[position.symbol] !== undefined) continue;
      prices[position.symbol] =
        position.symbol === snapshot.symbol ? snapshot.price : currentPriceFor(position);
    }
    paper.closeAll(prices);
    useTerminal.getState().pushToast(
      "Replay tugadi — " +
        opened.length +
        " pozitsiya " +
        fmtPrice(snapshot.price, digitsFor(snapshot.symbol)) +
        " bo'yicha yopildi"
    );
  }, [replayActive]);

  // Keep the lots input in sync when the persisted value changes elsewhere.
  useEffect(() => {
    setLotsText(lots.toFixed(2));
  }, [lots]);

  // Clear ticket levels when the instrument changes (stale SL/TP would be misleading).
  useEffect(() => {
    setSlText("");
    setTpText("");
    setError("");
  }, [symbol]);

  // SL/TP watcher: every quote tick, market-close positions whose level was hit.
  // Mounted even while the panel is closed so stops keep working in the background.
  useEffect(() => {
    const check = (nextQuotes: Record<string, Quote>) => {
      const paper = usePaper.getState();
      if (!paper.positions.length) return;
      const replay = useReplay.getState();
      const exits: { id: string; price: number }[] = [];
      for (const position of paper.positions) {
        // Replay paytida jonli narx bilan noto'g'ri yopilmasin — replay watcheri ishlaydi.
        if (replay.active && position.symbol === replay.symbol) continue;
        const current = nextQuotes[position.symbol];
        if (!current) continue;
        const currentBid = Number(current.bid);
        const currentAsk = Number(current.ask);
        if (!Number.isFinite(currentBid) || !Number.isFinite(currentAsk)) continue;
        if (currentBid <= 0 || currentAsk <= 0) continue;
        const market = position.side === "buy" ? currentBid : currentAsk;
        if (position.sl !== null && Number.isFinite(position.sl)) {
          const hit = position.side === "buy" ? market <= position.sl : market >= position.sl;
          if (hit) {
            exits.push({ id: position.id, price: position.sl });
            continue;
          }
        }
        if (position.tp !== null && Number.isFinite(position.tp)) {
          const hit = position.side === "buy" ? market >= position.tp : market <= position.tp;
          if (hit) exits.push({ id: position.id, price: position.tp });
        }
      }
      if (!exits.length) return;
      for (const exit of exits) paper.close(exit.id, exit.price);
      useTerminal.getState().pushToast("SL/TP: " + exits.length + " pozitsiya yopildi");
    };

    check(useTerminal.getState().quotes);
    return useTerminal.subscribe((state, prev) => {
      if (state.quotes === prev.quotes) return;
      check(state.quotes);
    });
  }, []);

  // Replay SL/TP watcher: faqat kursor OLDINGA surilganda (yangi sham ochilganda)
  // tekshiramiz — step back qilinganda hech narsa yopilmaydi.
  useEffect(() => {
    const prev = prevCursorRef.current;
    prevCursorRef.current = replayCursor;
    if (!replayActive || !replaySymbol || replayCursor === null) return;
    if (prev === null || replayCursor <= prev) return;
    const bar = replayLastBar();
    if (!bar) return;
    const paper = usePaper.getState();
    if (!paper.positions.length) return;
    const exits: { id: string; price: number }[] = [];
    for (const position of paper.positions) {
      if (position.symbol !== replaySymbol) continue;
      if (position.sl !== null && Number.isFinite(position.sl)) {
        const hit = position.side === "buy" ? bar.low <= position.sl : bar.high >= position.sl;
        if (hit) {
          exits.push({ id: position.id, price: position.sl });
          continue;
        }
      }
      if (position.tp !== null && Number.isFinite(position.tp)) {
        const hit = position.side === "buy" ? bar.high >= position.tp : bar.low <= position.tp;
        if (hit) exits.push({ id: position.id, price: position.tp });
      }
    }
    if (!exits.length) return;
    let closed = 0;
    for (const exit of exits) {
      // Boshqa joyda yopilgan bo'lishi mumkin — ikki marta yopmaymiz.
      const stillOpen = usePaper.getState().positions.some((item) => item.id === exit.id);
      if (!stillOpen) continue;
      usePaper.getState().close(exit.id, exit.price);
      closed += 1;
    }
    if (closed > 0) useTerminal.getState().pushToast("Replay SL/TP: " + closed + " pozitsiya yopildi");
  }, [replayActive, replaySymbol, replayCursor]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") usePaperUI.getState().closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  /* ------------------------------------------------------------- actions */

  const stepLots = (delta: number) => {
    const next = clampLots(lots + delta);
    setLots(next);
    setLotsText(next.toFixed(2));
  };

  const commitLots = () => {
    const parsed = Number(lotsText.trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setLotsText(lots.toFixed(2));
      return;
    }
    const next = clampLots(parsed);
    setLots(next);
    setLotsText(next.toFixed(2));
  };

  const submit = (side: Side) => {
    setSide(side);
    const terminal = useTerminal.getState();
    const instrument = symbol;
    // Replay paytida bu bid/ask replay kursorining narxidan hisoblangan.
    const price = side === "buy" ? ask : bid;
    if (!ready || !Number.isFinite(price) || price <= 0) {
      setError("Narx mavjud emas — ulanishni kuting");
      return;
    }
    const sl = readLevel(slText);
    const tp = readLevel(tpText);
    if (sl === "invalid") {
      setError("SL narxi noto‘g‘ri (musbat raqam kiriting)");
      return;
    }
    if (tp === "invalid") {
      setError("TP narxi noto‘g‘ri (musbat raqam kiriting)");
      return;
    }
    const currentDigits =
      terminal.meta && terminal.meta.symbol === instrument ? terminal.meta.digits : digitsFor(instrument);
    const result = usePaper.getState().open({
      side,
      lots,
      symbol: instrument,
      price,
      digits: currentDigits,
      sl,
      tp,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError("");
    setSlText("");
    setTpText("");
    terminal.pushToast(result.message);
  };

  const closeRow = (position: Position) => {
    const mid = currentPriceFor(position);
    const pnl = positionPnl(position, mid);
    closePosition(position.id, mid);
    useTerminal.getState().pushToast(position.symbol + " yopildi · " + fmtSigned(pnl) + " USD");
  };

  const closeEverything = () => {
    const paper = usePaper.getState();
    if (!paper.positions.length) return;
    const terminal = useTerminal.getState();
    const prices: Record<string, number> = {};
    for (const position of paper.positions) {
      // Replay instrumenti uchun replay narxi, boshqalari uchun jonli quote mid.
      if (prices[position.symbol] === undefined) prices[position.symbol] = currentPriceFor(position);
    }
    const count = paper.positions.length;
    closeAll(prices);
    terminal.pushToast("Barcha pozitsiyalar yopildi (" + count + ")");
  };

  const resetAccount = () => {
    const confirmed = window.confirm(
      "Hisobni " + PAPER_START_BALANCE + " USD ga tiklaysizmi? Barcha pozitsiyalar va savdo tarixi o‘chiriladi."
    );
    if (!confirmed) return;
    resetPaper();
    setSlText("");
    setTpText("");
    setError("");
    useTerminal.getState().pushToast("Paper hisob tiklandi — " + PAPER_START_BALANCE + " USD");
  };

  /* ----------------------------------------------------------------- view */

  return (
    <section className="pp-panel" role="dialog" aria-label="Paper trade">
      <div className="pp-head">
        <div className="pp-head-main">
          <div className="pp-title">
            <Wallet size={13} />
            <span>Paper trade</span>
            <span className="pp-title-tag">DEMO</span>
            {inReplay ? <span className="pp-replay-tag">REPLAY</span> : null}
          </div>
          <div className="pp-note">
            {inReplay ? "Replay kursoridagi narx · real order yuborilmaydi" : "Simulyatsiya — real order yuborilmaydi"}
          </div>
        </div>
        <button className="pp-x" type="button" title="Yopish (Esc)" onClick={closePanel}>
          <X size={14} />
        </button>
      </div>

      <div className="pp-body">
        <div className="pp-acct">
          <div className="pp-acct-cell">
            <div className="pp-acct-lb">Balans</div>
            <div className="pp-acct-val">{fmtUsd(balance)}</div>
          </div>
          <div className="pp-acct-cell">
            <div className="pp-acct-lb">Ekvit</div>
            <div className="pp-acct-val">{fmtUsd(equity)}</div>
          </div>
          <div className="pp-acct-cell">
            <div className="pp-acct-lb">Suzuvchi PnL</div>
            <div className={"pp-acct-val " + pnlClass(floating)}>{fmtSigned(floating)}</div>
          </div>
          <div className="pp-acct-cell">
            <div className="pp-acct-lb">Ochiq pozitsiyalar</div>
            <div className="pp-acct-val">{positions.length}</div>
          </div>
        </div>

        <div className="pp-sec">
          <div className="pp-instrument">
            <span className="pp-instrument-sym">{symbol}</span>
            {inReplay ? (
              <span className="pp-instrument-state replay">replay · {replayTimeLabel}</span>
            ) : (
              <span className={ready ? "pp-instrument-state live" : "pp-instrument-state"}>
                {ready ? "live · 0.3s" : "narx kutilmoqda…"}
              </span>
            )}
          </div>

          <div className="pp-quote">
            <div className="pp-quote-cell">
              <span className="pp-quote-lb">BID</span>
              <span className="pp-quote-val sell">{ready ? fmtPrice(bid, digits) : "—"}</span>
            </div>
            <div className="pp-quote-cell">
              <span className="pp-quote-lb">ASK</span>
              <span className="pp-quote-val buy">{ready ? fmtPrice(ask, digits) : "—"}</span>
            </div>
          </div>

          <div className="pp-field">
            <div className="pp-lb">
              <span>Lot</span>
              <span>0.01 – 100</span>
            </div>
            <div className="pp-step">
              <button className="pp-step-btn" type="button" title="Lotni kamaytirish" onClick={() => stepLots(-0.01)}>
                <Minus size={13} />
              </button>
              <input
                className="pp-step-input"
                aria-label="Lot hajmi"
                inputMode="decimal"
                value={lotsText}
                onChange={(event) => setLotsText(event.target.value)}
                onBlur={commitLots}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    commitLots();
                    event.currentTarget.blur();
                  }
                }}
              />
              <button className="pp-step-btn" type="button" title="Lotni ko‘paytirish" onClick={() => stepLots(0.01)}>
                <Plus size={13} />
              </button>
            </div>
          </div>

          <div className="pp-levels">
            <div className="pp-field">
              <div className="pp-lb">
                <span>SL</span>
                <span>ixtiyoriy</span>
              </div>
              <input
                className="pp-input"
                aria-label="Stop loss narxi"
                inputMode="decimal"
                placeholder="SL narxi"
                value={slText}
                onChange={(event) => {
                  setSlText(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit(selectedSide);
                  }
                }}
              />
            </div>
            <div className="pp-field">
              <div className="pp-lb">
                <span>TP</span>
                <span>ixtiyoriy</span>
              </div>
              <input
                className="pp-input"
                aria-label="Take profit narxi"
                inputMode="decimal"
                placeholder="TP narxi"
                value={tpText}
                onChange={(event) => {
                  setTpText(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit(selectedSide);
                  }
                }}
              />
            </div>
          </div>

          {error ? <div className="pp-error">{error}</div> : null}

          <div className="pp-hint">
            Tanlangan: <b>{selectedSide === "buy" ? "BUY" : "SELL"}</b> · Enter — yuborish
          </div>

          <div className="pp-actions">
            <button
              className={"pp-action sell" + (selectedSide === "sell" ? " selected" : "")}
              type="button"
              disabled={!ready}
              title={ready ? "SELL " + symbol + " · bid " + fmtPrice(bid, digits) : "Narx kutilmoqda…"}
              onClick={() => submit("sell")}
            >
              <span className="pp-action-lb">SELL</span>
              <span className="pp-action-px">{ready ? fmtPrice(bid, digits) : "—"}</span>
            </button>
            <button
              className={"pp-action buy" + (selectedSide === "buy" ? " selected" : "")}
              type="button"
              disabled={!ready}
              title={ready ? "BUY " + symbol + " · ask " + fmtPrice(ask, digits) : "Narx kutilmoqda…"}
              onClick={() => submit("buy")}
            >
              <span className="pp-action-lb">BUY</span>
              <span className="pp-action-px">{ready ? fmtPrice(ask, digits) : "—"}</span>
            </button>
          </div>
        </div>

        <div className="pp-sec">
          <div className="pp-sec-head">
            <span className="pp-sec-title">Pozitsiyalar · {positions.length}</span>
            <button
              className="pp-link"
              type="button"
              disabled={!positions.length}
              title="Barcha pozitsiyalarni joriy narxda yopish"
              onClick={closeEverything}
            >
              Hammasini yopish
            </button>
          </div>

          {positions.length === 0 ? (
            <div className="pp-empty">Ochiq pozitsiya yo‘q. BID/ASK narxida savdo oching.</div>
          ) : (
            <div className="pp-pos-list">
              {positions.map((position) => {
                const current = currentPriceFor(position);
                const hasPrice = Number.isFinite(current) && current > 0;
                const pnl = positionPnl(position, current);
                return (
                  <div className="pp-pos" key={position.id}>
                    <div className="pp-pos-main">
                      <span className={"pp-badge " + position.side}>
                        {position.side === "buy" ? "BUY" : "SELL"}
                      </span>
                      <span className="pp-pos-sym">{position.symbol}</span>
                      <span className="pp-pos-lots">{position.lots.toFixed(2)} lot</span>
                      <span className={"pp-pos-pnl " + pnlClass(pnl)}>{fmtSigned(pnl)}</span>
                      <button
                        className="pp-pos-x"
                        type="button"
                        disabled={!hasPrice}
                        title={hasPrice ? "Pozitsiyani joriy narxda yopish" : "Narx kutilmoqda…"}
                        onClick={() => closeRow(position)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="pp-pos-sub">
                      <span>Kirish {fmtPrice(position.entry, position.digits)}</span>
                      <span>Joriy {hasPrice ? fmtPrice(current, position.digits) : "—"}</span>
                      {position.sl !== null ? <span>SL {fmtPrice(position.sl, position.digits)}</span> : null}
                      {position.tp !== null ? <span>TP {fmtPrice(position.tp, position.digits)}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pp-sec">
          <div className="pp-sec-head">
            <span className="pp-sec-title">Tarix · oxirgi 8</span>
          </div>
          {history.length === 0 ? (
            <div className="pp-empty">Yopilgan savdolar yo‘q.</div>
          ) : (
            <div className="pp-hist-list">
              {history.slice(0, 8).map((trade) => (
                <div className="pp-hist-row" key={trade.id}>
                  <span className="pp-hist-time">{hhmm(trade.closed)}</span>
                  <span className={"pp-badge " + trade.side}>{trade.side === "buy" ? "BUY" : "SELL"}</span>
                  <span className="pp-hist-sym">{trade.symbol}</span>
                  <span className={"pp-hist-pnl " + pnlClass(trade.pnl)}>{fmtSigned(trade.pnl)}</span>
                  <span className="pp-hist-sub">
                    {trade.lots.toFixed(2)} lot · {fmtPrice(trade.entry, digitsFor(trade.symbol))} →{" "}
                    {fmtPrice(trade.exit, digitsFor(trade.symbol))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="pp-foot">
        <button className="pp-reset" type="button" title="Balansni 10 000 USD ga qaytarish" onClick={resetAccount}>
          <RotateCcw size={11} />
          <span>Hisobni tiklash</span>
        </button>
        <span className="pp-foot-note">Boshlang‘ich ${PAPER_START_BALANCE.toLocaleString("en-US")}</span>
      </div>
    </section>
  );
}

export default TradePanel;
