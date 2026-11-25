"""MetaTrader 5 -> in-memory tick/candle feed.

One polling thread reads ticks for every configured symbol and keeps the last
candle of every subscribed (symbol, timeframe) pair up to date. The async layer
in main.py drains Feed.pending and pushes deltas to websocket clients.
"""
from __future__ import annotations

import datetime
import logging
import threading
import time
from typing import Dict, List, Optional, Tuple

import MetaTrader5 as mt5

from config import (
    FILL_GAPS,
    MAX_BARS_KEEP,
    MAX_FILL_BARS,
    MT5_TERMINAL_PATH,
    POLL_SECONDS,
    RESAMPLE,
    SYMBOL_META,
    SYMBOLS,
    TF_SECONDS,
)

log = logging.getLogger("feed")

Key = Tuple[str, str]

MT5_TF = {
    "1m": mt5.TIMEFRAME_M1,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "1D": mt5.TIMEFRAME_D1,
    "1W": mt5.TIMEFRAME_W1,
}


def _bar(raw, offset: int = 0) -> dict:
    return {
        "time": int(raw["time"]) - offset,
        "open": float(raw["open"]),
        "high": float(raw["high"]),
        "low": float(raw["low"]),
        "close": float(raw["close"]),
        "volume": float(raw["tick_volume"]),
    }


def _fill_gaps(bars: List[dict], seconds: int) -> List[dict]:
    """Insert flat bars for minutes the broker produced no tick for.

    Keeps the rendered chart continuous (no visual holes) exactly like MT5 does.
    Long gaps (weekends, daily rollover) are left alone.
    """
    if not FILL_GAPS or len(bars) < 2:
        return bars
    out: List[dict] = [bars[0]]
    for bar in bars[1:]:
        gap = bar["time"] - out[-1]["time"]
        if seconds < gap <= seconds * MAX_FILL_BARS:
            prev = out[-1]
            stamp = prev["time"] + seconds
            while stamp < bar["time"]:
                out.append({
                    "time": stamp,
                    "open": prev["close"],
                    "high": prev["close"],
                    "low": prev["close"],
                    "close": prev["close"],
                    "volume": 0.0,
                })
                stamp += seconds
        out.append(bar)
    return out


def _resample(bars: List[dict], seconds: int) -> List[dict]:
    out: List[dict] = []
    for b in bars:
        bucket = b["time"] // seconds * seconds
        if out and out[-1]["time"] == bucket:
            cur = out[-1]
            cur["high"] = max(cur["high"], b["high"])
            cur["low"] = min(cur["low"], b["low"])
            cur["close"] = b["close"]
            cur["volume"] += b["volume"]
        else:
            out.append({
                "time": bucket,
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b["volume"],
            })
    return out


class Feed:
    def __init__(self) -> None:
        self._mt5_lock = threading.RLock()
        self._lock = threading.Lock()
        self.ticks: Dict[str, dict] = {}
        self.symbols: Dict[str, dict] = {}
        self.candles: Dict[Key, List[dict]] = {}
        self.pending: Dict[Key, dict] = {}
        self.interest: Dict[Key, int] = {}
        self.server_offset = 0
        self.ready = False
        self.error: Optional[str] = None
        self.connected = False
        self.started_at = time.time()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------ lifecycle
    def start(self) -> bool:
        with self._mt5_lock:
            if not mt5.initialize(MT5_TERMINAL_PATH or None, timeout=60000):
                self.error = "mt5.initialize failed: %s" % (mt5.last_error(),)
                log.error(self.error)
                return False
            for sym in SYMBOLS:
                info = mt5.symbol_info(sym)
                if info is None:
                    log.warning("symbol %s missing on this account", sym)
                    continue
                if not info.visible:
                    mt5.symbol_select(sym, True)
                    info = mt5.symbol_info(sym)
                self.symbols[sym] = {
                    "symbol": sym,
                    "name": SYMBOL_META.get(sym, {}).get("name", info.description),
                    "kind": SYMBOL_META.get(sym, {}).get("kind", "forex"),
                    "digits": int(info.digits),
                    "point": float(info.point),
                    "spread": int(info.spread),
                    "description": info.description,
                    "visible": True,
                }
            for sym in self.symbols:
                tick = mt5.symbol_info_tick(sym)
                if tick is not None and tick.time:
                    offset = int(round((tick.time - time.time()) / 900.0) * 900)
                    if -14400 <= offset <= 14400:
                        self.server_offset = offset
                    break
            self.connected = True
        self.ready = True
        self._thread = threading.Thread(target=self._poll_loop, name="mt5-poll", daemon=True)
        self._thread.start()
        log.info("feed ready: %d symbols, server offset %+ds", len(self.symbols), self.server_offset)
        return True

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        with self._mt5_lock:
            try:
                mt5.shutdown()
            except Exception:
                pass
        self.ready = False
        self.connected = False

    # -------------------------------------------------------------- polling
    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            t0 = time.time()
            try:
                self._poll_once()
            except Exception:
                log.exception("tick poll failed")
            time.sleep(max(0.0, POLL_SECONDS - (time.time() - t0)))

    def _poll_once(self) -> None:
        for sym in list(self.symbols):
            with self._mt5_lock:
                tick = mt5.symbol_info_tick(sym)
            if tick is None or not tick.time_msc:
                continue
            prev = self.ticks.get(sym)
            if prev is not None and prev["msc"] == tick.time_msc:
                continue
            mid = (tick.bid + tick.ask) / 2.0
            quote = {
                "symbol": sym,
                "bid": float(tick.bid),
                "ask": float(tick.ask),
                "mid": mid,
                "time": int(tick.time) - self.server_offset,
                "msc": int(tick.time_msc),
            }
            self.ticks[sym] = quote
            self._apply_tick(sym, quote)

    def _apply_tick(self, sym: str, quote: dict) -> None:
        ts = quote["time"]
        mid = quote["mid"]
        for key, n in list(self.interest.items()):
            if n <= 0 or key[0] != sym:
                continue
            bars = self.candles.get(key)
            if not bars:
                continue
            seconds = TF_SECONDS[key[1]]
            bucket = ts // seconds * seconds
            last = bars[-1]
            if bucket > last["time"]:
                self._refill(key, 4)
                continue
            if bucket < last["time"]:
                continue
            last["high"] = max(last["high"], mid)
            last["low"] = min(last["low"], mid)
            last["close"] = mid
            last["volume"] = float(last.get("volume", 0.0)) + 1.0
            self._mark(key, {"mode": "bar", "bar": dict(last)})

    # ----------------------------------------------------------------- data
    def _fetch(self, sym: str, tf: str, count: int) -> List[dict]:
        native_tf = RESAMPLE[tf][0] if tf in RESAMPLE else tf
        native_count = count * RESAMPLE[tf][1] + 1 if tf in RESAMPLE else count
        with self._mt5_lock:
            raw = mt5.copy_rates_from_pos(sym, MT5_TF[native_tf], 0, native_count)
        if raw is None or len(raw) == 0:
            return []
        bars = [_bar(r, self.server_offset) for r in raw]
        if tf in RESAMPLE:
            seconds = TF_SECONDS[tf]
            bars = _resample(bars, seconds)
            if len(bars) > 1 and bars[0]["time"] + seconds > bars[1]["time"]:
                bars = bars[1:]
        return _fill_gaps(bars, TF_SECONDS[tf])

    def _refill(self, key: Key, tail: int = 4) -> None:
        sym, tf = key
        fresh = self._fetch(sym, tf, max(8, tail + 4))
        if not fresh:
            return
        with self._lock:
            current = self.candles.get(key) or []
            keep = [b for b in current if b["time"] < fresh[0]["time"]]
            merged = (keep + fresh)[-MAX_BARS_KEEP:]
            if not merged:
                return
            self.candles[key] = merged
            self.pending[key] = {"mode": "reset", "bars": merged[-tail:]}

    def fetch_before(self, sym: str, tf: str, end_time: int, count: int) -> List[dict]:
        """Load 'count' bars strictly older than 'end_time' (true UTC seconds).

        Powers infinite scroll: the browser walks further into the past whenever the
        user drags the chart to the left edge. MT5 wants the boundary in server clock.
        """
        if count <= 0 or end_time <= 0:
            return []
        native_tf = RESAMPLE[tf][0] if tf in RESAMPLE else tf
        ratio = RESAMPLE[tf][1] if tf in RESAMPLE else 1
        native_count = min(count * ratio + ratio + 1, 60000)
        stop = datetime.datetime.utcfromtimestamp(end_time + self.server_offset)
        with self._mt5_lock:
            raw = mt5.copy_rates_from(sym, MT5_TF[native_tf], stop, native_count)
        if raw is None or len(raw) == 0:
            return []
        bars = [_bar(r, self.server_offset) for r in raw]
        if tf in RESAMPLE:
            seconds = TF_SECONDS[tf]
            bars = _resample(bars, seconds)
            if len(bars) > 1 and bars[0]["time"] + seconds > bars[1]["time"]:
                bars = bars[1:]
        bars = [b for b in bars if b["time"] < end_time]
        return bars[-count:]

    def ensure_history(self, sym: str, tf: str, count: int) -> List[dict]:
        key: Key = (sym, tf)
        with self._lock:
            bars = self.candles.get(key)
        if bars and len(bars) >= max(50, count - 2):
            return bars[-count:]
        fresh = self._fetch(sym, tf, count)
        if not fresh:
            return []
        with self._lock:
            self.candles[key] = fresh[-MAX_BARS_KEEP:]
            return self.candles[key][-count:]

    # ------------------------------------------------------------ subscription
    def set_interest(self, key: Key, delta: int) -> None:
        with self._lock:
            self.interest[key] = self.interest.get(key, 0) + delta
            if self.interest[key] <= 0:
                self.interest.pop(key, None)

    def drain_pending(self) -> Dict[Key, dict]:
        with self._lock:
            if not self.pending:
                return {}
            out = self.pending
            self.pending = {}
            return out

    def _mark(self, key: Key, payload: dict) -> None:
        with self._lock:
            self.pending[key] = payload

    def quotes_snapshot(self) -> Dict[str, dict]:
        return {sym: self.ticks[sym] for sym in list(self.ticks)}

    def status(self) -> dict:
        tick = None
        with self._mt5_lock:
            try:
                tick = mt5.symbol_info_tick("EURUSD")
            except Exception:
                tick = None
        return {
            "ready": self.ready,
            "error": self.error,
            "connected": self.connected,
            "serverOffset": self.server_offset,
            "uptime": round(time.time() - self.started_at, 1),
            "symbols": len(self.symbols),
            "live": tick is not None and bool(tick.time_msc),
        }
