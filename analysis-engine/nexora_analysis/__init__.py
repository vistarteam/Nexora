"""NEROXA technical-analysis engine.

Public API:

    from nexora_analysis import analyze

    result = analyze({"symbol": "BINANCE:BTCUSDT", "timeframe": "1h", "candles": [...]})

The engine only ever computes indicators from the candles it is explicitly
given. It never fetches data, never guesses, and never claims to predict the
market. See `docs/ANALYSIS-ENGINE.md` for the full JSON contract.
"""

from .engine import (
    DEFAULT_OPTIONS,
    ENGINE_ID,
    ENGINE_NAME,
    ENGINE_VERSION,
    MINIMUM_CANDLES,
    EngineInputError,
    analyze,
    decode_candles,
    required_candle_count,
)

__all__ = [
    "analyze",
    "decode_candles",
    "required_candle_count",
    "EngineInputError",
    "DEFAULT_OPTIONS",
    "ENGINE_ID",
    "ENGINE_NAME",
    "ENGINE_VERSION",
    "MINIMUM_CANDLES",
]

__version__ = ENGINE_VERSION
