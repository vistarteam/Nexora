# NEXORA Analysis Engine — JSON Contract

This document is the authoritative JSON contract for the analysis engine, both
for the Python implementation (`analysis-engine/nexora_analysis/`) and for the
TypeScript reference that mirrors it (`backend/src/services/analysis/reference/`).
The two engines are byte-for-byte aligned on the shapes below; `engine.id` is
the only field that says which one actually ran.

Cheat-sheet: read `status` first. Only when `status === "ok"` do `facts`,
`interpretation` and `scenarios` carry content; otherwise they are `null`/`[]`
and `reason` explains why, in Persian.

## Request

```jsonc
{
  "symbol": "BINANCE:BTCUSDT",  // metadata only; echoed in wording
  "timeframe": "1h",            // metadata only; used in wording
  "candles": [                  // ascending by time; OHLCV objects
    { "time": 1700000000000, "open": 1.0, "high": 2.0,
      "low": 0.5, "close": 1.5, "volume": 100.0 }
  ],
  "options": {                  // every key optional; defaults shown below
    "rsiPeriod": 14,
    "macdFast": 12, "macdSlow": 26, "macdSignal": 9,
    "smaPeriods": [20, 50, 200],
    "emaPeriods": [9, 21, 55],
    "atrPeriod": 14,
    "swingLookback": 5,
    "maxLevels": 5,
    "includeSeries": false
  }
}
```

At least 5 usable candles are required for *any* result; the full indicator set
needs 205 (`SMA200` warm-up). Below the floor the engine returns
`status: "insufficient_data"` / `"unavailable"` with `facts: null` — it never
pads, interpolates, or invents candles.

## Response

```jsonc
{
  "engine": { "id": "python" | "typescript-fallback",
              "name": "nexora-analysis-engine" | "nexora-analysis-reference",
              "version": "0.3.0" },
  "status": "ok" | "insufficient_data" | "unavailable",
  "requiredCandles": 205,
  "receivedCandles": 300,
  "facts": { ... },              // null unless status === "ok"
  "interpretation": { ... },     // null unless status === "ok"
  "scenarios": [ ... ],          // [] unless status === "ok"
  "series": { ... } | null,      // present only when options.includeSeries
  "warnings": [ "متن هشدار..." ],
  "reason": null | "متن فارسی..."
}
```

### facts

```jsonc
"facts": {
  "lastCandle":   { "time": 1700000000000, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100.0 },
  "candleCount":  300,
  "changePercent": 12.4,            // (last close - first close) / first close * 100
  "volatilityPercent": 0.42,        // SEE the two-volatility note below
  "indicators": {
    "rsi":  { "value": 61.2, "state": "bullish_bias", "signal": "bullish" },
    "macd": { "macd": 1.2, "signal": 0.9, "histogram": 0.3,
              "state": "bullish_rising", "signalDirection": "bullish" },
    "sma":  [ { "period": 20, "value": 100.1, "state": "above", "signal": "bullish" } ],
    "ema":  [ { "period": 9,  "value": 100.4, "state": "above", "signal": "bullish" } ],
    "atr":  { "value": 1.8, "state": "volatility", "signal": "neutral" }
  },
  "trend": {
    "direction": "uptrend" | "downtrend" | "sideways" | "unknown",
    "strength": 62.0,               // 0-100 (bounded), NOT a probability
    "evidence": [
      "شیب خط برازش‌شده روی 90 کندل برابر ...",
      "آماره t این شیب ...",
      "نوسان بازده‌ها (انحراف معیار روی آخرین 90 کندل روند) ...",
      "ساختار سقف‌ها: ...",
      "ساختار کف‌ها: ..."
    ],
    "higherHighs": true, "higherLows": true
  },
  "levels": {
    "supports":     [ { "price": 90.0, "touches": 3, "kind": "swing" | "pivot", "distancePercent": -1.2 } ],
    "resistances":  [ { "price": 110.0, "touches": 2, "kind": "swing" | "pivot", "distancePercent": 1.8 } ],
    "nearestSupport":    { ... },   // first row of supports (nearest-first)
    "nearestResistance": { ... }    // first row of resistances (nearest-first)
  }
}
```


#### The two volatility numbers

The report shows two volatility figures **on purpose**, each named in the
Persian output so they can never be confused for one number:

1. **`facts.volatilityPercent`** — population standard deviation of
   close-to-close returns over the **whole supplied series** (e.g. all 300
   candles). `interpretation.volatilityReading` reports this value and labels
   it "انحراف معیار ساده روی کل N کندل".
2. **Trend evidence "نوسان بازده‌ها ..."** — population standard deviation of
   close-to-close returns over **only the rolling trend window**
   (`min(candleCount, 90)`), the same window the slope was fitted on. The
   evidence line labels it "انحراف معیار روی آخرین N کندل روند".

The two are **not** reconciled into one number: they answer different questions
(whole-history variability vs the variability that shaped the current trend) and
the engines deliberately do not force them equal. When `candleCount <= 90` both
windows coincide and the numbers agree. Always quote the label alongside a value.

### interpretation

```jsonc
"interpretation": {
  "summary": "در تایم‌فریم 1h، روند فعلی ... «صعودی» خوانده می‌شود ...",
  "trendReading":    "شیب اندازه‌گیری‌شده ... درصد در هر کندل است. ...",
  "momentumReading": "RSI ...",
  "volatilityReading": "نوسان بازده‌ها (انحراف معیار ساده روی کل 300 کندل) برابر ... درصد است؛ ...",
  "caveats": ["تمام اعداد این بخش از کندل‌های ورودی محاسبه شده‌اند ..."]
}
```

`facts` holds numbers computed from candles; `interpretation` holds prose
*about* those numbers and is visually separated from them everywhere it is
rendered. Nothing here predicts the market.

### scenarios

```jsonc
{
  "id": "breakout-up",
  "title": "شکست مقاومت نزدیک",
  "bias": "bullish" | "bearish" | "neutral",
  "condition": "بسته‌شدن یک کندل بالای ...",
  "invalidation": "بازگشت قیمت به زیر ...",
  "confidence": "high" | "medium" | "low"
}
```

Each documented scenario is conditional (a `condition` activates it) and
falsifiable (an `invalidation` cancels it). They are never packaged as
outcome guarantees.


### series (chart payload, `options.includeSeries: true`)

```jsonc
"series": {
  "count": 300,
  "sma":  { "20": [null, ...], "50": [...], "200": [...] },
  "ema":  { "9": [...], "21": [...], "55": [...] },
  "rsi": [null, ..., 61.2],
  "macd": { "macd": [...], "signal": [...], "histogram": [...] },
  "atr": [null, ..., 1.8],
  "swings": { "highs": [{ "index": 40, "price": 95.0 }],
              "lows":  [{ "index": 30, "price": 88.0 }] },
  "regression": { "slope": 0.02, "intercept": 90.0, "window": 90, "startIndex": 210 }
}
```

Every array has exactly `count` entries, entry `i` belongs to `candles[i]`,
`null` marks the warm-up region, and the last defined value of each line is the
same number `facts.indicators` reports for the newest bar — a chart drawn from
this block cannot contradict the text report.

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

`strength` is a 0–100 measure of how pronounced the observed move is — it is
**not** a probability and never a guarantee.

## Status honesty

- `ok` — facts and interpretation computed from the supplied candles.
- `insufficient_data` — usable but fewer candles than the indicator set needs;
  no conclusions are drawn.
- `unavailable` — fewer than 5 usable candles (or none at all); no conclusions
  are drawn.

Invalid rows are dropped or repaired and named in `warnings`; the engine never
silently absorbs bad bars and never emits a fabricated result.

