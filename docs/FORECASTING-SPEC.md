# Nexora Predictive Engine — Forecasting Specification

**Version:** 0.1.0 | **Date:** 2026-10-17 | **Status:** Implementation Phase

## Mission

Upgrade Nexora from rule-based technical analysis to **probabilistic forecasting**:
- Predict future returns with honest uncertainty
- Evaluate out-of-sample with real transaction costs
- Report failure openly when no statistical edge exists

## Problem Definition

### What We Predict

**A. Future Returns**
- Log return: `ln(price[t+h] / price[t])`
- Horizons: 15m, 1h, 4h, 1d
- Output: Point + 90% confidence interval

**B. Directional Probability**
- `P(return > 0)`, `P(return < 0)`, `P(|return| < ε)`
- Calibrated: If model says 70%, actual must be ~70%

**C. Market Regime**
- Classes: uptrend, downtrend, range, high_volatility

**D. Trading Signal**
- Trade or abstain based on Sharpe > 0.5 after costs

### Success Metrics

**Prediction:**
- Brier Score < baseline
- Direction accuracy > 50%
- RMSE < historical volatility

**Trading:**
- Sharpe > 0 (risk-adjusted return)
- Max drawdown < 20%
- Profit factor > 1.0

## Data Requirements

**Minimum:** 500-2,000 candles per horizon
**Storage:** JSON → PostgreSQL when needed
**Anti-leakage:** Features at time T use only `candles[:T]`

## Feature Engineering

**Returns:** `return_1`, `return_5`, `return_20`, `return_std_20`
**Indicators:** RSI, MACD, SMA/EMA distances, ATR
**Structure:** distance to support/resistance, trend strength
**Volume:** ratio, trend (if reliable)

**Version Control:** Every feature set tagged with version + timestamp

## Baseline Models (Must Beat These)

1. **Zero:** Predict 0% return (random walk)
2. **Historical Mean:** Training period average
3. **Momentum:** Continuation of recent trend
4. **Mean Reversion:** Return toward long-term mean
5. **Last Return:** Most recent return

## Walk-Forward Validation

```
[Train: 60d][Validation: 15d][Test: 15d] → Step 7d forward
   ^^^^                         ^^^^         
   Fit here                     Evaluate here
```

**Rules:**
- Never test on training data
- Tune on validation only
- Test set touched once

## Transaction Costs

- Commission: 0.1%
- Spread: 0.05%
- Slippage: 0.05%
- **Total: 0.2% per trade (0.4% round-trip)**

**Reality:** Need >0.4% edge per trade to break even

## Paper Trading

1. Generate forecast → store with timestamp
2. Wait for horizon
3. Record actual outcome
4. Compute calibration + accuracy

**Before Live:** 100+ trades, Sharpe > 0.5, calibration error < 0.1

## Implementation Phases

**Week 1:** Data layer + Feature engineering
**Week 2:** Baseline models + Validation framework
**Week 3:** First ML model (Logistic Regression)
**Week 4:** Backtesting with costs
**Week 5:** Paper trading system
**Week 6:** API + UI integration

## Acceptance Criteria

1. ✅ Probabilistic forecasts with uncertainty
2. ✅ Out-of-sample validation (3+ months)
3. ✅ Transaction costs in all metrics
4. ✅ Sharpe > 0.5 after costs
5. ✅ Calibration: Brier < 0.2
6. ✅ 100+ paper trades matching backtest
7. ✅ Documented failure modes
8. ✅ Manual review before real capital

**Failure is Acceptable:** If no model beats baseline after costs, report honestly.
