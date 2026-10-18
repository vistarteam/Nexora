/**
 * Baseline Forecasting Models.
 *
 * Every ML model must beat these simple rules on out-of-sample data.
 * If we can't beat random walk or momentum, we don't have an edge.
 */

import type { Candle, Timeframe } from '../../types/domain.js';
import type { BaselineModelType, BaselineForecast, ForecastHorizon } from '../../types/forecasting.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('forecasting:baseline');

/**
 * Generate baseline forecast for comparison.
 */
export function generateBaselineForecast(params: {
  model: BaselineModelType;
  symbol: string;
  timeframe: Timeframe;
  horizon: ForecastHorizon;
  candles: Candle[];
}): BaselineForecast {
  const { model, symbol, timeframe, horizon, candles } = params;

  if (candles.length < 2) {
    return {
      model,
      symbol,
      horizon,
      generatedAt: new Date().toISOString(),
      referencePrice: candles[candles.length - 1]?.close ?? 0,
      predictedReturn: 0,
      predictedDirection: 'neutral',
    };
  }

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];
  let predictedReturn = 0;

  switch (model) {
    case 'zero':
      predictedReturn = 0; // Random walk: no expected change
      break;

    case 'historical_mean': {
      const returns = computeReturns(closes);
      const meanReturn = returns.length > 0 ? mean(returns) : 0;
      predictedReturn = meanReturn ?? 0;
      break;
    }

    case 'momentum': {
      // Predict continuation of recent trend (last 5 periods)
      const returns = computeReturns(closes);
      const recentReturns = returns.slice(-5);
      const momentum = recentReturns.length > 0 ? mean(recentReturns) : 0;
      predictedReturn = momentum ?? 0;
      break;
    }

    case 'mean_reversion': {
      // Predict return toward long-term mean
      const longTermMean = closes.length >= 200 ? mean(closes.slice(-200)) : mean(closes);
      if (longTermMean && lastClose !== undefined) {
        const deviation = (lastClose - longTermMean) / longTermMean;
        predictedReturn = -deviation * 0.5; // Half-reversion
      }
      break;
    }

    case 'last_return': {
      // Extreme momentum: last return continues
      const returns = computeReturns(closes);
      predictedReturn = returns[returns.length - 1] ?? 0;
      break;
    }
  }

  // Determine direction based on threshold
  const threshold = 0.001; // 0.1% log return
  let direction: 'up' | 'down' | 'neutral';
  if (predictedReturn > threshold) {
    direction = 'up';
  } else if (predictedReturn < -threshold) {
    direction = 'down';
  } else {
    direction = 'neutral';
  }

  log.debug('Baseline forecast generated', {
    model,
    symbol,
    horizon,
    predictedReturn: predictedReturn.toFixed(6),
    direction,
  });

  return {
    model,
    symbol,
    horizon,
    generatedAt: new Date().toISOString(),
    referencePrice: lastClose ?? 0,
    predictedReturn,
    predictedDirection: direction,
  };
}

/**
 * Generate all baseline forecasts for comparison.
 */
export function generateAllBaselines(params: {
  symbol: string;
  timeframe: Timeframe;
  horizon: ForecastHorizon;
  candles: Candle[];
}): BaselineForecast[] {
  const models: BaselineModelType[] = ['zero', 'historical_mean', 'momentum', 'mean_reversion', 'last_return'];

  return models.map((model) =>
    generateBaselineForecast({
      model,
      ...params,
    }),
  );
}

// Helper functions

function computeReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev && prev > 0 && curr !== undefined) {
      returns.push(Math.log(curr / prev));
    }
  }
  return returns;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
