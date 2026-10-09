# NEXORA Analysis Engine

A small, dependency-free Python module that computes technical indicators from
candle data that **you supply**. It does not fetch data, does not read the
clock, and does not predict prices.

- Python 3.10+ (developed against 3.14)
- Standard library only — nothing to install
- 49 unit tests covering the indicator maths, level detection, trend
  classification, and the engine's status/honesty guarantees

## Design rules

1. **Facts, interpretation and scenarios are separate.** `facts` contains only
   numbers computed from the candles. `interpretation` contains prose derived
   from those numbers. `scenarios` are conditional and hypothetical.
2. **No data, no conclusion.** Too few candles yields
   `status: "insufficient_data"` (or `"unavailable"` for nothing usable) with
   `facts: null`. The engine never pads, interpolates, or invents candles.
3. **No certainty, ever.** The output never claims a guaranteed outcome, and
   the wording explicitly states that readings can be invalidated by the next
   candle.
4. **Bad bars are reported.** Invalid candles are skipped or repaired and the
   reason is listed in `warnings`; they are never silently absorbed.

## Layout

```
analysis-engine/
├── cli.py                     # stdin/stdout entry point used by the backend
├── server.py                  # optional HTTP wrapper (stdlib only)
├── nexora_analysis/
│   ├── __init__.py            # public API: analyze(), decode_candles(), ...
│   ├── indicators.py          # SMA, EMA, RSI, MACD, ATR, stdev
│   ├── trend.py               # least-squares slope + swing structure
│   ├── levels.py              # swing clustering + classic pivots
│   └── engine.py              # validation, orchestration, narrative, scenarios
└── tests/                     # unittest suite
```

## Usage

### As a library

```python
from nexora_analysis import analyze

result = analyze({
    "symbol": "BINANCE:BTCUSDT",
    "timeframe": "1h",
    "candles": [{"time": 1700000000000, "open": 1.0, "high": 2.0,
                 "low": 0.5, "close": 1.5, "volume": 100.0}, ...],
    "options": {"rsiPeriod": 14, "smaPeriods": [20, 50, 200]},
})
print(result["status"])          # "ok" | "insufficient_data" | "unavailable"
print(result["facts"])
print(result["interpretation"]["summary"])
```

### Via the CLI (how the backend calls it)

```bash
echo '{"symbol":"BINANCE:BTCUSDT","timeframe":"1h","candles":[...]}' | python cli.py
```

Exit codes: `0` processed, `2` input could not be parsed, `1` unexpected error.
Output is UTF-8 with Persian text preserved.

### Via HTTP (optional)

```bash
python server.py --port 8000
curl -s http://127.0.0.1:8000/health
curl -s -X POST http://127.0.0.1:8000/analyze \
  -H 'content-type: application/json' \
  --data-binary @payload.json
```

## Request contract

```jsonc
{
  "symbol": "BINANCE:BTCUSDT",   // metadata only, echoed in logs
  "timeframe": "1h",             // metadata only, used in wording
  "candles": [                   // ascending by time; OHLCV objects
    { "time": 1700000000000, "open": 1.0, "high": 2.0,
      "low": 0.5, "close": 1.5, "volume": 100.0 }
  ],
  "options": {                   // all optional
    "rsiPeriod": 14,
    "macdFast": 12, "macdSlow": 26, "macdSignal": 9,
    "smaPeriods": [20, 50, 200],
    "emaPeriods": [9, 21, 55],
    "atrPeriod": 14,
    "swingLookback": 5,
    "maxLevels": 5
  }
}
```

## Response contract

```jsonc
{
  "engine": { "id": "python", "name": "nexora-analysis-engine", "version": "0.2.0" },
  "status": "ok",
  "requiredCandles": 40,
  "receivedCandles": 300,
  "facts": {
    "lastCandle": { "time": 0, "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0 },
    "candleCount": 300,
    "changePercent": 12.4,
    "volatilityPercent": 0.42,
    "indicators": {
      "rsi":     { "value": 61.2, "state": "bullish_bias", "signal": "bullish" },
      "macd":    { "macd": 1.2, "signal": 0.9, "histogram": 0.3,
                   "state": "bullish_rising", "signalDirection": "bullish" },
      "sma":     [{ "period": 20, "value": 100.1, "state": "above", "signal": "bullish" }],
      "ema":     [{ "period": 9,  "value": 100.4, "state": "above", "signal": "bullish" }],
      "atr":     { "value": 1.8, "state": "volatility", "signal": "neutral" }
    },
    "trend":  { "direction": "uptrend", "strength": 62.0, "evidence": ["..."],
                "higherHighs": true, "higherLows": true },
    "levels": { "supports": [...], "resistances": [...],
                "nearestSupport": {...}, "nearestResistance": {...} }
  },
  "interpretation": {
    "summary": "...", "trendReading": "...", "momentumReading": "...",
    "volatilityReading": "...", "caveats": ["..."]
  },
  "scenarios": [
    { "id": "breakout-up", "title": "...", "bias": "bullish",
      "condition": "...", "invalidation": "...", "confidence": "medium" }
  ],
  "warnings": [],
  "reason": null
}
```

When `status !== "ok"`, `facts`, `interpretation` and `scenarios` are `null`/`[]`
and `reason` explains why in Persian.

## Indicator conventions

| Indicator | Method | Warm-up |
|---|---|---|
| SMA | rolling mean | `period - 1` |
| EMA | seeded with the SMA of the first window | `period - 1` |
| RSI | Wilder smoothing of gains/losses | first value at index `period` |
| MACD | EMA(fast) − EMA(slow); signal = EMA of the defined MACD span | `slow + signal` |
| ATR | Wilder smoothing of true range | `period` |
| Trend | least-squares slope normalised by volatility, plus swing structure | `max_window` capped at 90 bars |
| Levels | swing extrema clustered within `0.75 × ATR`, plus classic pivots | `2 × lookback + 3` bars |

`strength` is a 0–100 measure of how pronounced the observed move is. It is not
a probability.

## Tests

```bash
# from the repository root
python -m unittest discover -s analysis-engine/tests -t analysis-engine -v

# or from this directory
python -m unittest discover -s tests -t . -v
```
