# Nexora Predictive Engine — Implementation Progress

**Started:** 2026-10-17  
**Status:** Foundation Phase (Week 1)

---

## ✅ Completed

### Phase 0: Critical Fixes
- ✅ Fixed TypeScript typecheck error (`referenceEngine.test.ts:223`)
- ✅ Removed volume claim without calculation from scenarios
- ⚠️ `probePythonEngine` already fixed in codebase (uses CLI probe)

### Phase 1: Type Definitions & Specification
- ✅ Complete type system (`backend/src/types/forecasting.ts`)
  - ForecastResult, ForecastOutcome
  - FeatureSet with version control
  - BaselineModelType, BacktestConfig
  - CalibrationResult, PaperTradingSession
- ✅ Forecasting specification (`docs/FORECASTING-SPEC.md`)
  - Problem definition (returns, direction, regime)
  - Success metrics (Brier < baseline, Sharpe > 0)
  - Data requirements (500-2,000 candles)
  - Transaction cost model (0.4% round-trip)

### Phase 2: Data Layer
- ✅ Historical data service (`backend/src/services/data/historicalDataService.ts`)
  - In-memory storage with deduplication
  - Time-range queries
  - Data quality assessment
  - Gap detection and freshness tracking
  - Dataset versioning

### Phase 3: Feature Engineering
- ✅ Feature extraction (`backend/src/services/forecasting/featureEngineering.ts`)
  - Returns: `return_1`, `return_5`, `return_20`, `return_std_20`
  - Momentum: `return_std_ratio`
  - Technical: RSI, MACD, SMA/EMA distances, ATR
  - Structure: higher highs/lows, distance to recent high/low
  - Volume: `volume_ratio`
  - **Anti-leakage:** Only uses `candles[:asOfTime]`
  - Feature version: `v1.0.0`

### Phase 4: Baseline Models
- ✅ Baseline forecasting (`backend/src/services/forecasting/baselineModels.ts`)
  - Zero (random walk hypothesis)
  - Historical mean
  - Momentum (last 5 periods)
  - Mean reversion (toward 200-SMA)
  - Last return (extreme momentum)

### Phase 5: Forecast Service + Tests
- ✅ Main forecast service (`backend/src/services/forecasting/forecastService.ts`)
  - Aggregates features + baselines into complete `ForecastResult`
  - Multi-horizon expiration handling (`15m/1h/4h/1d`)
  - Market regime classification (uptrend/downtrend/range/high_volatility/unknown)
  - Confidence derivation from data quality + signal strength
  - Honest warnings on insufficient/degraded data
  - `generateAllBaselineForecasts()` helper for comparison
- ✅ Unit tests (`backend/tests/forecasting.test.ts`, 12 tests)
  - historicalDataService (4 tests)
  - featureEngineering (3 tests)
  - baselineModels (2 tests)
  - forecastService (3 tests)
- ✅ All backend tests green (207 passed, 11 files) + Python engine tests (69 passed)
- ✅ Fixed parity bug: Python rendered `1.0` where TS rendered `1` → `{volatility:g}`

---

## 🔄 In Progress

Currently: Walk-forward validation and data persistence

---

## 📋 Next Steps

### Immediate (Next 2 Hours)
1. ~~Create main forecasting service~~ ✅
2. Implement simple walk-forward validation
3. ~~Write basic tests~~ ✅ (12 forecasting tests)
4. ~~Verify typecheck passes~~ ✅
5. Demo baseline forecasts on BTCUSDT 1h

### This Week
1. Store & accumulate historical data (auto-fetch on analysis)
2. Implement evaluation metrics (RMSE, direction accuracy)
3. First ML model: Logistic Regression for direction
4. Calibration analysis (Brier score)
5. Compare ML vs baselines

### Week 2
1. Backtest framework with transaction costs
2. Walk-forward validation (60d train, 15d val, 15d test)
3. Regime-conditional performance
4. Max drawdown tracking

### Week 3-4
1. Paper trading system
2. Real-time forecast generation
3. Outcome tracking after horizon
4. Live calibration dashboard

### Week 5-6
1. API endpoints (`POST /api/forecast`, `GET /api/forecast/:id`)
2. Frontend components
3. Documentation
4. Production readiness checklist

---

## 📊 Current Capabilities

**Can Do Now:**
- Extract 20+ features from candle history
- Generate 5 baseline forecasts
- Generate complete multi-horizon `ForecastResult` with regime + confidence
- Assess data quality (good/degraded/insufficient)
- Store historical candles with deduplication
- Track dataset versions

**Cannot Do Yet:**
- Actual ML predictions (only baselines)
- Backtesting with costs
- Paper trading
- Calibration analysis
- API integration

---

## 🎯 Success Criteria Tracking

| Criterion | Status | Notes |
|-----------|--------|-------|
| Probabilistic forecasts | 🔄 In progress | Baseline models done |
| Out-of-sample validation | ❌ Not started | Need walk-forward |
| Transaction costs | ✅ Defined | 0.4% round-trip |
| Sharpe > 0.5 | ❌ Not evaluated | Need backtest |
| Brier < 0.2 | ❌ Not evaluated | Need calibration |
| 100+ paper trades | ❌ Not started | - |
| Documented failures | ✅ Spec ready | Will report honestly |
| Manual review gate | ✅ Designed | No auto-trading |

---

## 🚨 Known Limitations

1. **Data Volume:** Need to accumulate 2,000+ candles (currently fetch max 1,000)
2. **Storage:** In-memory only (will lose data on restart)
3. **Models:** Only baselines implemented
4. **Validation:** No backtesting yet
5. **Costs:** Model defined but not applied in evaluation

---

## 🔍 Testing Status

- ✅ Typecheck passes (`npm run typecheck`)
- ✅ Unit tests: `tests/forecasting.test.ts` (12 tests)
- ✅ Full backend suite: 207 tests across 11 files
- ✅ Python engine: 69 tests
- ✅ Engine parity test now runs and passes (probe CLI fix exposed + fixed a real `1.0` vs `1` rendering bug)
- ⚠️ Integration tests: Not written yet

---

## 📝 Notes

- **Philosophy:** Build foundation correctly, then add complexity
- **Anti-Pattern Avoided:** No "build ML first, figure out data later"
- **Next Milestone:** First working forecast (baseline) on real data
- **ETA for Demo:** 2 hours (forecast service + integration)

## Follow-up upgrade: levels, touchpoints and risk planning (2026-10-18)

- Added optional timestamped `touchpoints` metadata to the TypeScript and Python support/resistance outputs. The analysis engine passes candle timestamps into level detection; the frontend type contract now carries the same metadata.
- `AnalysisChart` can render support/resistance touchpoints as coloured candle markers and exposes a toolbar toggle. Markers are sorted by chart time before being sent to Lightweight Charts.
- Added `backend/src/services/strategy/riskSizing.ts`, a deterministic hypothetical sizing helper with explicit `no_trade` outcomes, risk cap validation, reward/risk threshold, fee/slippage estimates, and bounded suggested leverage.
- Added `accountBalance`, `riskPercent`, and chart-layer preference fields to `SettingsContext` defaults so the UI can persist these preferences as part of the existing settings object.
- Added `ScenariosPanel.tsx`, which derives bullish/base/bearish scenario values from the existing forecast return point and bounds, keeping values tied to the same forecast response.
- Added unit tests for risk sizing and Python timestamped touchpoints.

### Validation and remaining integration work

- `python -m pytest analysis-engine/tests -q`: **70 passed**.
- TypeScript/Vitest build was not run in this environment because dependencies are not installed here. Run `npm install` and `npm run verify` in the project's supported Windows environment before merging.
- This update does **not** claim zero-lag parity with TradingView. The current live ticker remains sequential polling; no exchange WebSocket feed, venue-level reconciliation, or authenticated execution path was added. Chart scenario paths are currently a presentation component derived from forecast outputs and are not yet wired into a dedicated projected-time-series overlay. Account settings are stored, but the UI settings form still needs controls for editing them.
