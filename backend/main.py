"""FastAPI websocket API that streams MT5 ticks and candles to the terminal UI."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Dict, Optional, Set, Tuple

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import BROADCAST_SECONDS, HEARTBEAT_SECONDS, MAX_BARS_KEEP, SYMBOLS, TF_SECONDS
from feed import Feed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

feed = Feed()
clients: Dict[str, "Client"] = {}
_counter = [0]


class Client:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.subs: Set[Tuple[str, str]] = set()
        self.alive = True


async def send_all(payload: dict) -> None:
    text = json.dumps(payload, separators=(",", ":"))
    for client in list(clients.values()):
        try:
            await client.ws.send_text(text)
        except Exception:
            client.alive = False


async def flush_bars() -> None:
    pending = feed.drain_pending()
    if not pending:
        return
    for key, payload in pending.items():
        symbol, tf = key
        if payload.get("mode") == "reset":
            msg = {"type": "bars", "symbol": symbol, "tf": tf, "bars": payload["bars"]}
        else:
            msg = {"type": "bar", "symbol": symbol, "tf": tf, "bar": payload["bar"]}
        text = json.dumps(msg, separators=(",", ":"))
        for client in list(clients.values()):
            if key in client.subs:
                try:
                    await client.ws.send_text(text)
                except Exception:
                    client.alive = False


async def broadcast_loop() -> None:
    last_quotes = 0.0
    while True:
        await asyncio.sleep(BROADCAST_SECONDS)
        try:
            await flush_bars()
            now = time.time()
            if now - last_quotes >= HEARTBEAT_SECONDS:
                last_quotes = now
                await send_all({
                    "type": "heartbeat",
                    "ts": int(now * 1000),
                    "serverOffset": feed.server_offset,
                    "status": feed.status(),
                    "quotes": feed.quotes_snapshot(),
                })
        except Exception:
            log.exception("broadcast failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not feed.start():
        log.error("MT5 feed failed to start: %s", feed.error)
    task = asyncio.create_task(broadcast_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        feed.stop()


app = FastAPI(title="FX Terminal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": feed.ready, **feed.status()}


@app.get("/api/symbols")
async def symbols():
    return {"symbols": [feed.symbols[s] for s in feed.symbols]}


@app.get("/api/history")
async def history(
    symbol: str = Query("EURUSD"),
    tf: str = Query("1m"),
    count: int = Query(500, ge=10, le=5000),
    before: int = Query(0, ge=0),
):
    if tf not in TF_SECONDS:
        raise HTTPException(status_code=400, detail="unknown timeframe")
    if symbol not in feed.symbols:
        raise HTTPException(status_code=404, detail="unknown symbol")
    if before > 0:
        bars = await asyncio.to_thread(feed.fetch_before, symbol, tf, before, count)
    else:
        bars = await asyncio.to_thread(feed.ensure_history, symbol, tf, min(count, MAX_BARS_KEEP))
    return {"symbol": symbol, "tf": tf, "bars": bars, "meta": feed.symbols.get(symbol, {}), "serverOffset": feed.server_offset}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _counter[0] += 1
    cid = str(_counter[0])
    client = Client(ws)
    clients[cid] = client
    log.info("ws client %s connected (%d total)", cid, len(clients))
    try:
        await ws.send_text(json.dumps({
            "type": "hello",
            "symbols": [feed.symbols[s] for s in feed.symbols],
            "status": feed.status(),
            "serverOffset": feed.server_offset,
            "quotes": feed.quotes_snapshot(),
        }, separators=(",", ":")))
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            op = msg.get("op")
            if op == "sub":
                symbol = str(msg.get("symbol", "EURUSD"))
                tf = str(msg.get("tf", "1m"))
                count = max(10, min(int(msg.get("count", 400)), MAX_BARS_KEEP))
                if symbol not in feed.symbols or tf not in TF_SECONDS:
                    await ws.send_text(json.dumps({"type": "error", "message": "unknown symbol or timeframe"}))
                    continue
                key = (symbol, tf)
                bars = await asyncio.to_thread(feed.ensure_history, symbol, tf, count)
                if key not in client.subs:
                    client.subs.add(key)
                    feed.set_interest(key, 1)
                await ws.send_text(json.dumps({
                    "type": "init",
                    "symbol": symbol,
                    "tf": tf,
                    "bars": bars,
                    "meta": feed.symbols.get(symbol, {}),
                    "serverOffset": feed.server_offset,
                }, separators=(",", ":")))
            elif op == "more":
                symbol = str(msg.get("symbol", "EURUSD"))
                tf = str(msg.get("tf", "1m"))
                before = int(msg.get("before", 0) or 0)
                count = max(50, min(int(msg.get("count", 1500)), 5000))
                if symbol not in feed.symbols or tf not in TF_SECONDS or before <= 0:
                    await ws.send_text(json.dumps({"type": "more", "symbol": symbol, "tf": tf, "before": before, "bars": []}))
                    continue
                bars = await asyncio.to_thread(feed.fetch_before, symbol, tf, before, count)
                await ws.send_text(json.dumps({
                    "type": "more",
                    "symbol": symbol,
                    "tf": tf,
                    "before": before,
                    "bars": bars,
                }, separators=(",", ":")))
            elif op == "unsub":
                key = (str(msg.get("symbol")), str(msg.get("tf")))
                if key in client.subs:
                    client.subs.discard(key)
                    feed.set_interest(key, -1)
            elif op == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("ws error")
    finally:
        for key in list(client.subs):
            feed.set_interest(key, -1)
        clients.pop(cid, None)
        log.info("ws client %s disconnected", cid)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8787, log_level="info")
