# Nexora Codebase Audit Report

- **Date**: 2026-10-15
- **Scope**: `analysis-engine/` (Python), `backend/`, `frontend/`
- **Test status (at review time)**: Python 66 ✅ · Backend 193 ✅ (incl. engine parity) · Frontend 89 ✅

---

## Executive Summary

| ID | Severity | Title | Affected |
|----|----------|-------|---------|
| [1.1](#11-high--two-different-volatility-metrics-surfaced-in-one-report) | **High** | Two different volatility metrics surfaced in the same report | `analysis-engine/.../engine.py`, `analysis-engine/.../trend.py` |
| [2.1](#21-medium--market-data-source-inconsistency-chart-vs-analysis) | **Medium** | Market data source inconsistency: chart vs analysis | `backend/.../nobitexProvider.ts`, `frontend/.../TradingViewChart.tsx`, `.freebuff/chart.json` |
| [3.1](#31-low--referenced-docsdirectory-does-not-exist) | **Low** | Referenced `docs/` directory does not exist | `analysis-engine/nexora_analysis/__init__.py` |

---

## Finding 1.1 — [High] Two different volatility metrics surfaced in one report

### Summary

The persisted analysis reports expose two different measures of "volatility" for the same instrument, under different labels, and the discrepancy is not reconciled anywhere:

1. **`facts.volatilityPercent`** — computed by `engine._build_facts(...)` as the standard deviation of **all** close-to-close returns in the full candle series (`stdev(returns)` over every returned candle, 300 in the stored reports).
2. **Trend evidence quote "نوسان بازده‌ها …"** — computed by `trend.classify_trend(...)` as the standard deviation of returns over **only the rolling trend window** (`min(len(closes), max_window=90)`).

Because `engine._build_facts` and `trend.classify_trend` run on the same series but use different windows, the same report can show two numbers for "volatility" that do not match.

### Exact quotes from stored reports (`.data/analysis-reports.json`)

**BTCUSDT — 15m (id `3cd87106-d139-40c6-a910-d740934611c8`):**

- `facts.volatilityPercent = 0.195` (line 242)
- Trend evidence (line 308): `"نوسان بازده‌ها 0.237 درصد در هر کندل است."`
- Interpretation `volatilityReading` (line ~392): `"نوسان محاسبه‌شده 0.195 درصد است؛ …"` — matches `facts.volatilityPercent`, further splitting the two numbers.

**XAUUSD — 5m (id `b748fa7d-d680-424e-9628-6a8be1909aa3`):**

- `facts.volatilityPercent = 0.0944` (line 30)
- Trend evidence (line 96): `"نوسان بازده‌ها 0.148 درصد در هر کندل است."`
- Interpretation `volatilityReading` (line 186): `"نوسان محاسبه‌شده 0.0944 درصد است؛ بازار کم‌نوسان است."`

| Instrument | Whole-series `facts.volatilityPercent` (300 candles) | 90-candle window (trend evidence) |
|-----------|-----------------------------------------------------|----------------------------------|
| BTCUSDT 15m | 0.195 | 0.237 |
| XAUUSD 5m | 0.0944 | 0.148 |

### Code root cause

- `analysis-engine/nexora_analysis/engine.py` lines 285–290 and 300:

```python
returns = [
    (closes[index] - closes[index - 1]) / closes[index - 1]
    for index in range(1, len(closes))
    if closes[index - 1] != 0
]
volatility = stdev(returns)
...
"volatilityPercent": None if volatility is None else round(volatility * 100.0, 4),
```

This is the **whole-series** stdev, exposed as `facts.volatilityPercent`.

- `analysis-engine/nexora_analysis/trend.py` lines 168–201 and 234–236:

```python
window = min(len(closes), max_window)   # max_window = 90
window_closes = [float(value) for value in closes[-window:]]
...
returns = [ ... window_closes ... ]
volatility = variance ** 0.5
...
evidence.append(f"نوسان بازده‌ها {volatility * 100:.3f} درصد در هر کندل است.")
```

This is the **90-candle-window** stdev, embedded in `facts.trend.evidence`.

### Impact

- Users comparing `facts.volatilityPercent` with the trend evidence (or with `interpretation.volatilityReading`) see conflicting numbers for a single "volatility" concept.
- The `volatilityReading` summary relays the whole-series value, so the report internally fights itself: the trend section implies one volatility and the summary another.
- Any consumer building risk framing on "volatility" cannot tell which measure is authoritative.

### Recommendation

- Pick a single canonical volatility definition across `_build_facts` and `classify_trend` (either both on the full series, or both on the same rolling window), or expose them as two explicitly-named fields (e.g. `volatilityPercent` vs `trendWindowVolatilityPercent`) and label each in the Persian evidence text.
- Add an engine-parity test that asserts the evidence volatility equals `facts.volatilityPercent` when `len(candles) <= 90` and, when `len(candles) > 90`, asserts the two are forwarded/distinguished explicitly.


---

## Finding 2.1 — [Medium] Market data source inconsistency: chart vs analysis

### Summary

There are two coexisting data sources behind the same page/symbol, and the naming makes them easy to conflate:

- The backend market-data service feeds the analysis engine from **Nobitex** (`backend/src/services/marketData/nobitexProvider.ts`). The persisted `chart.json` records `"dataSource": "nobitex"`, `"mode": "live"`, and the candle source as `{ "provider": "nobitex", ... }`, while the symbol itself is `BINANCE:BTCUSDT`.
- The `TradingViewChart.tsx` widget embeds the **official TradingView widget** keyed to the same TradingView ticker (`BINANCE:BTCUSDT`), which renders **Binance's own real-time feed**, with TradingView's own studies (`STD;EMA`, `STD;SMA`, `STD;RSI`, `STD;MACD`, `STD;Volume` — `TradingViewChart.tsx` lines 149–155).

### Exact evidence

- `.freebuff/chart.json`: `"symbol": "BINANCE:BTCUSDT"`, `"tvSymbol": "BINANCE:BTCUSDT"`, `"dataSource": "nobitex"`, `"source": {"provider": "nobitex", "mode": "live"}`.
- `.freebuff/candles.json`: `"symbol": "BINANCE:BTCUSDT"`, `"tvSymbol": "BINANCE:BTCUSDT"`, `"source": {"provider": "nobitex", "mode": "live", "fetchedAt": "2026-10-14T13:25:01.193Z"}`.
- `TradingViewChart.tsx` lines 14–20 state this is a **visual** integration only and that the two sources are "deliberately" separate; however, the report/chart payload does not distinguish `provider: nobitex` from the widget's `BINANCE:` feed to the end user beyond optional labelling.

### Impact

- Two different venues (Nobitex vs Binance) drive the same `BINANCE:BTCUSDT` view; prices/indicators on the chart can diverge from the analysis numbers on the same screen.
- The `BINANCE:` prefix suggests Binance data for everything, which is only true of the widget and not of the analysis.

### Recommendation

- Surface the analysis data provider (Nobitex) and the chart feed (Binance via TradingView) as two explicit, separate labels next to the chart, or render the analysis candles on the chart instead so chart and analysis always agree.
- Add a test asserting the chart payload `dataSource` matches the actual provider used, rather than inferring it from the symbol's venue prefix.


---

## Finding 3.1 — [Low] Referenced `docs/` directory does not exist

### Summary

`analysis-engine/nexora_analysis/__init__.py` line 11 references `docs/ANALYSIS-ENGINE.md` as the "full JSON contract" documentation, but no such `docs/` directory or file exists anywhere in the repository.

### Exact evidence

- `analysis-engine/nexora_analysis/__init__.py` line 11:
  > See `docs/ANALYSIS-ENGINE.md` for the full JSON contract.
- `Test-Path` results: `D:\Nexora\docs` → `False`; `D:\Nexora\analysis-engine\docs\ANALYSIS-ENGINE.md` → `False`; `D:\Nexora\docs\ANALYSIS-ENGINE.md` → `False`.
- The only README present is `analysis-engine/README.md` (at the engine root, not `docs/`), which does not duplicate the referenced contract file.

### Impact

- A broken documentation pointer: anyone following the docstring to read the JSON contract hits a missing file. The single source of truth for the output contract is effectively undocumented in-repo.

### Recommendation

- Either create `analysis-engine/docs/ANALYSIS-ENGINE.md` documenting the full JSON contract, or update `__init__.py` to point at the in-tree `README.md` (or the contract section already present there).

---

## Appendix A — Verified scope & test status

| Suite | Location | Count | Status |
|-------|----------|-------|--------|
| Python engine | `analysis-engine/tests/` | 66 | ✅ all pass |
| Backend (incl. engine parity) | `backend/tests/` | 193 | ✅ all pass |
| Frontend | `frontend/` | 89 | ✅ all pass |

## Appendix B — Files reviewed (evidence base)

- `analysis-engine/nexora_analysis/engine.py` (`_build_facts`, lines 262–334)
- `analysis-engine/nexora_analysis/trend.py` (`classify_trend`, lines 156–253)
- `analysis-engine/nexora_analysis/__init__.py` (docs reference, line 11)
- `.data/analysis-reports.json` (BTCUSDT 15m id `3cd87106-…`, XAUUSD 5m id `b748fa7d-…`)
- `.freebuff/chart.json`, `.freebuff/candles.json` (`dataSource: "nobitex"`)
- `backend/src/services/marketData/nobitexProvider.ts`, `backend/src/services/marketData/catalog.ts`
- `frontend/src/components/market/TradingViewChart.tsx`
- `backend/tests/engineParity.test.ts`, `backend/tests/referenceEngine.test.ts`

