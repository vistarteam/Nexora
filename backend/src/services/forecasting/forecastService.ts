/**
 * Main Forecasting Service.
 *
 * Wires together data layer, feature engineering, and baseline models into
 * a single forecast pipeline. Produces a complete ForecastResult per symbol
 * and horizon, with honest data-quality reporting when inputs are weak.
 */

import { randomUUID } from 'node:crypto';
import type { Candle, Timeframe } from '../../types/domain.js';
import type {
  BaselineForecast,
  BaselineModelType,
  ForecastConfidence,
  ForecastHorizon,
  ForecastResult,
  HorizonForecast,
  MarketRegime,
} from '../../types/forecasting.js';
import { createLogger } from '../../lib/logger.js';
import { extractFeatures } from './featureEngineering.js';
import { generateBaselineForecast } from './baselineModels.js';

const log = createLogger('forecasting:service');

/** Milliseconds per forecast horizon. */
export const HORIZON_MS: Record<ForecastHorizon, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

interface ForecastConfig {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  horizons?: ForecastHorizon[];
  baselineModel?: BaselineModelType;
  version?: string;
}

/**
 * Generate a complete probabilistic forecast for a symbol.
 *
 * Currently returns a baseline-driven forecast with uncertainty bounds and
 * market regime classification. ML models will slot in behind the same
 * interface once they are validated.
 */
export function generateForecast(config: ForecastConfig): ForecastResult {
  const {
    symbol,
    timeframe,
    candles,
    horizons = ['15m', '1h', '4h'],
    baselineModel = 'momentum',
    version = 'baseline-v0.1.0',
  } = config;

  const now = Date.now();
  const generatedAtMs = now;
  const generatedAt = new Date(now).toISOString();

  // Reference price: last close of most recent complete candle
  const referenceCandle = candles[candles.length - 1];
  const referencePrice = referenceCandle?.close ?? 0;
  const referenceTime = referenceCandle?.time ?? 0;

  // Extract features for regime/quality classification
  const featureSet = extractFeatures({
    symbol,
    timeframe,
    candles,
    asOfTime: referenceTime,
  });

  // Classify market regime from features
  const marketRegime = classifyRegime(featureSet.features);
  const dataQuality = featureSet.dataQuality;

  const warnings: string[] = [];
  if (dataQuality === 'insufficient') {
    warnings.push(`Insufficient data (${featureSet.candleCount} candles) for robust forecast`);
  }
  if (dataQuality === 'degraded') {
    warnings.push('Data quality is degraded; treat forecast with caution');
  }

  // Build per-horizon forecasts
  const horizonForecasts: HorizonForecast[] = horizons.map((duration) => {
    const expiresAtMs = generatedAtMs + HORIZON_MS[duration];
    const baseline = generateBaselineForecast({
      model: baselineModel,
      symbol,
      timeframe,
      horizon: duration,
      candles,
    });

    // Base confidence on data quality + volatility
    const confidence = deriveConfidence(dataQuality, baseline);

    return {
      duration,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs: HORIZON_MS[duration],
      returnForecast: {
        point: baseline.predictedReturn,
        lower: null,
        upper: null,
        coverage: 0.9, // Placeholder until interval calibration is implemented
      },
      directionProb: {
        up: null,
        down: null,
        neutral: null,
        threshold: 0.001,
      },
      marketRegime,
      confidence,
    };
  });

  const result: ForecastResult = {
    id: randomUUID(),
    symbol,
    timeframe,
    generatedAt,
    generatedAtMs,
    referencePrice,
    referenceTime,
    horizons: horizonForecasts,
    model: {
      id: baselineModel,
      version,
      description: `Baseline ${baselineModel} model`,
    },
    features: featureSet.features,
    dataQuality,
    warnings,
  };

  log.info('Forecast generated', {
    symbol,
    timeframe,
    horizons: horizonForecasts.length,
    regime: marketRegime,
    quality: dataQuality,
    referencePrice,
  });

  return result;
}

/**
 * Generate all baseline forecasts for comparison/debugging.
 */
export function generateAllBaselineForecasts(params: {
  symbol: string;
  timeframe: Timeframe;
  horizon: ForecastHorizon;
  candles: Candle[];
}): BaselineForecast[] {
  const models: BaselineModelType[] = [
    'zero',
    'historical_mean',
    'momentum',
    'mean_reversion',
    'last_return',
  ];

  return models.map((model) =>
    generateBaselineForecast({
      model,
      ...params,
    }),
  );
}

/**
 * Classify current market regime from extracted features.
 */
export function classifyRegime(features: Record<string, number | null>): MarketRegime {
  const volRatio = features.return_std_ratio;
  if (volRatio !== null && volRatio !== undefined && volRatio > 1.5) {
    return 'high_volatility';
  }

  const distSma50 = features.distance_sma_50;
  const distSma200 = features.distance_sma_200;

  if (distSma50 === null || distSma50 === undefined) {
    return 'unknown';
  }

  if (distSma50 > 0.01 && (distSma200 === null || distSma200 === undefined || distSma200 > -0.01)) {
    return 'uptrend';
  }
  if (distSma50 < -0.01) {
    return 'downtrend';
  }
  return 'range';
}

/**
 * Derive a forecast confidence level.
 */
function deriveConfidence(dataQuality: 'good' | 'degraded' | 'insufficient', baseline: BaselineForecast): ForecastConfidence {
  if (dataQuality === 'insufficient') return 'low';
  if (dataQuality === 'degraded') return 'medium';

  const absReturn = Math.abs(baseline.predictedReturn);
  // High confidence only for strong signals on clean data
  if (absReturn > 0.004) return 'high';
  if (absReturn > 0.002) return 'medium';
  return 'low';
}
