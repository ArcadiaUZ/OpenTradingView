"""Static configuration for the FX terminal backend."""
import os

# Path to terminal64.exe. Leave empty (default) to attach to a running MT5 terminal.
# Set the MT5_TERMINAL_PATH environment variable for a non-default install location.
MT5_TERMINAL_PATH = os.environ.get("MT5_TERMINAL_PATH", "")

SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "XAUUSD"]

SYMBOL_META = {
    "EURUSD": {"name": "Euro / U.S. Dollar", "ticker": "EURUSD", "kind": "forex"},
    "GBPUSD": {"name": "British Pound / U.S. Dollar", "ticker": "GBPUSD", "kind": "forex"},
    "USDJPY": {"name": "U.S. Dollar / Japanese Yen", "ticker": "USDJPY", "kind": "forex"},
    "USDCHF": {"name": "U.S. Dollar / Swiss Franc", "ticker": "USDCHF", "kind": "forex"},
    "USDCAD": {"name": "U.S. Dollar / Canadian Dollar", "ticker": "USDCAD", "kind": "forex"},
    "AUDUSD": {"name": "Australian Dollar / U.S. Dollar", "ticker": "AUDUSD", "kind": "forex"},
    "NZDUSD": {"name": "New Zealand Dollar / U.S. Dollar", "ticker": "NZDUSD", "kind": "forex"},
    "XAUUSD": {"name": "Gold / U.S. Dollar", "ticker": "XAUUSD", "kind": "metal"},
}

# timeframe keys -> seconds
TF_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "1D": 86400, "1W": 604800,
}

# timeframes MT5 has no native constant for: (base timeframe, ratio)
RESAMPLE = {"3m": ("1m", 3), "2h": ("1h", 2)}

FILL_GAPS = False         # True: forward-fill quiet minutes into flat bars (hides
                          # the real night-time gaps); False: show broker data as-is
MAX_FILL_BARS = 12        # never bridge weekends/holidays

POLL_SECONDS = 0.10       # MT5 tick poll cadence
BROADCAST_SECONDS = 0.10  # websocket flush cadence
HEARTBEAT_SECONDS = 0.30  # quote + heartbeat cadence (0.3s requirement)
MAX_BARS_KEEP = 6000
