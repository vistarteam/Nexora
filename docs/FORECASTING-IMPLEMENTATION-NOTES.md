# Forecasting implementation notes

## Scope added
- Point-in-time feature extraction filters candles by candle timestamp, optional `ingestedAt`, and explicit `isClosed === false` metadata.
- RSI, SMA, EMA, MACD line/signal/histogram, ATR, log returns, realized volatility, and volume/structure features are implemented.
- Forecast horizons produce point estimates, approximate 90% intervals, and directional probabilities.
- Strategy backtest includes explicit abstention, stop/target checks, position sizing, transaction costs, Sharpe, drawdown, and profit factor.
- `ForecastPanel` provides a responsive Persian RTL display component.

## Important limitations
The probability estimates and intervals are Gaussian approximations over recent historical returns. They are **not calibrated probabilities**, do not prove predictive edge, and are not a production trading signal. Perform walk-forward evaluation and paper trading before relying on them.

`Candle`'s public domain contract currently has no mandatory ingestion timestamp or close flag. The feature layer supports optional `ingestedAt` and `isClosed` metadata if a provider supplies them. A candle with no close flag is not automatically assumed closed. Provider adapters should populate these fields when they can establish closure and ingestion time.

The backtest service is a deterministic library, not yet exposed as an API route. `ForecastPanel` is a standalone component because the current app's analysis-report API returns technical-analysis reports rather than `ForecastResult`; connect it only after adding a forecast API contract.
