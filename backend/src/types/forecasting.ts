/**
 * Forecasting domain types for Nexora Predictive Engine.
 *
 * These types define the contract for probabilistic market forecasts,
 * baseline models, feature engineering, backtesting, and paper trading.
 *
 * Core principles:
 * - No data leakage: features use only data available at prediction time
 * - Probabilistic output: point estimates + uncertainty + calibration
 * - Honest evaluation: out-of-sample metrics, transaction costs included
 * - Falsifiable: every forecast has an expiration time and actual outcome
 */

import type { Timeframe } from './domain.js';

/** Forecast horizon duration matching available timeframes. */
export type ForecastHorizon = '15m' | '1h' | '4h' | '1d';

/** Market regime classification. */
export type MarketRegime = 'uptrend' | 'downtrend' | 'range' | 'high_volatility' | 'unknown';

/** Data quality assessment for forecasting. */
export type DataQuality = 'good' | 'degraded' | 'insufficient';

/** Confidence level based on model uncertainty and data quality. */
export type ForecastConfidence = 'low' | 'medium' | 'high';

/** Model identifier with version for reproducibility. */
export interface ModelIdentifier {
  /** Model family, e.g., 'baseline-naive', 'logistic-v1', 'gbm-v2' */
  id: string;
  /** Semantic version */
  version: string;
  /** Human-readable description */
  description: string;
}

/**
 * Return forecast for a specific time horizon.
 *
 * Returns are logarithmic: ln(price[t+h] / price[t])
 * Converted to percentage for display: return * 100
 */
export interface ReturnForecast {
  /** Point estimate of future return (can be null if model abstains) */
  point: number | null;
  /** Lower bound of prediction interval (e.g., 5th percentile) */
  lower: number | null;
  /** Upper bound of prediction interval (e.g., 95th percentile) */
  upper: number | null;
  /** Confidence interval coverage level (0.80, 0.90, 0.95) */
  coverage: number;
}

/**
 * Directional probability forecast.
 *
 * Must sum to ~1.0 when all three present (accounting for rounding).
 * Calibrated: if P(up)=0.6, then 60% of similar forecasts should be up.
 */
export interface DirectionProbability {
  /** Probability that return > threshold */
  up: number | null;
  /** Probability that return < -threshold */
  down: number | null;
  /** Probability that |return| < threshold (noise range) */
  neutral: number | null;
  /** Threshold used to define neutral zone (log return) */
  threshold: number;
}

/** Single horizon forecast combining all prediction types. */
export interface HorizonForecast {
  /** Duration string, e.g., '1h' */
  duration: ForecastHorizon;
  /** Absolute expiration timestamp (ISO 8601) */
  expiresAt: string;
  /** Milliseconds until expiration (for sorting/display) */
  expiresInMs: number;

  /** Return prediction with uncertainty bounds */
  returnForecast: ReturnForecast;
  /** Directional probability */
  directionProb: DirectionProbability;
  /** Market regime classification */
  marketRegime: MarketRegime;
  /** Overall confidence in this forecast */
  confidence: ForecastConfidence;
}

/**
 * Complete forecast result for one symbol at one point in time.
 */
export interface ForecastResult {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  generatedAt: string;
  generatedAtMs: number;
  referencePrice: number;
  referenceTime: number;
  horizons: HorizonForecast[];
  model: ModelIdentifier;
  features: Record<string, number | null>;
  dataQuality: DataQuality;
  warnings: string[];
}

/**
 * Actual outcome for a forecast after horizon expires.
 */
export interface ForecastOutcome {
  forecastId: string;
  horizon: ForecastHorizon;
  actualReturn: number;
  actualDirection: 'up' | 'down' | 'neutral';
  actualPrice: number;
  recordedAt: string;
}

/**
 * Feature engineering result.
 */
export interface FeatureSet {
  asOfTime: number;
  symbol: string;
  timeframe: Timeframe;
  candleCount: number;
  features: Record<string, number | null>;
  featureVersion: string;
  dataQuality: DataQuality;
}

/**
 * Baseline model types.
 */
export type BaselineModelType =
  | 'zero'
  | 'historical_mean'
  | 'momentum'
  | 'mean_reversion'
  | 'last_return';

export interface BaselineForecast {
  model: BaselineModelType;
  symbol: string;
  horizon: ForecastHorizon;
  generatedAt: string;
  referencePrice: number;
  predictedReturn: number;
  predictedDirection: 'up' | 'down' | 'neutral';
}

/**
 * Backtest configuration.
 */
export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  trainWindowMs: number;
  validationWindowMs: number;
  testWindowMs: number;
  stepMs: number;
  model: ModelIdentifier;
  horizons: ForecastHorizon[];
}

export interface TransactionCosts {
  commission: number;
  spread: number;
  slippage: number;
  totalPerTrade: number;
}

export interface BacktestTrade {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  returnGross: number;
  returnNet: number;
  direction: 'long' | 'short';
  forecastId: string;
  reason: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  executedAt: string;
  trades: BacktestTrade[];
  metrics: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgReturnPerTrade: number;
    totalReturnGross: number;
    totalReturnNet: number;
    maxDrawdown: number;
    sharpeRatio: number | null;
    profitFactor: number | null;
  };
  regimePerformance: Record<MarketRegime, { trades: number; avgReturn: number }>;
  costs: TransactionCosts;
}

export interface PaperTradingSession {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  model: ModelIdentifier;
  startedAt: string;
  status: 'active' | 'paused' | 'stopped';
  forecastIds: string[];
  outcomeIds: string[];
}

export interface CalibrationBin {
  predictedProbMin: number;
  predictedProbMax: number;
  count: number;
  actualFrequency: number;
  brierScore: number;
}

export interface CalibrationResult {
  model: ModelIdentifier;
  horizon: ForecastHorizon;
  periodStart: string;
  periodEnd: string;
  totalForecasts: number;
  bins: CalibrationBin[];
  overallBrierScore: number;
  calibrationSlope: number;
  calibrationError: number;
}

