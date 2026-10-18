/**
 * Feature Engineering for Nexora Predictive Engine.
 *
 * Extracts quantitative features from historical candles.
 * All features use ONLY data available at asOfTime (no future peeking).
 */

import type { Candle, Timeframe } from '../../types/domain.js';
import type { FeatureSet, DataQuality } from '../../types/forecasting.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('forecasting:features');
const FEATURE_VERSION = 'v1.0.0';

export function extractFeatures(params: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  asOfTime: number;
}): FeatureSet {
  const { symbol, timeframe, candles, asOfTime } = params;
  const validCandles = candles.filter((c) => c.time <= asOfTime);

  if (validCandles.length < 50) {
    return {
      asOfTime,
      symbol,
      timeframe,
      candleCount: validCandles.length,
      features: {},
      featureVersion: FEATURE_VERSION,
      dataQuality: 'insufficient',
    };
  }

  const features: Record<string, number | null> = {};
  const closes = validCandles.map((c) => c.close);
  const highs = validCandles.map((c) => c.high);
  const lows = validCandles.map((c) => c.low);
  const volumes = validCandles.map((c) => c.volume);

  // Returns & Momentum
  const returns = computeReturns(closes);
  features.return_1 = returns[returns.length - 1] ?? null;
  features.return_5 = returns.length >= 5 ? mean(returns.slice(-5)) : null;
  features.return_20 = returns.length >= 20 ? mean(returns.slice(-20)) : null;
  features.return_std_20 = returns.length >= 20 ? std(returns.slice(-20)) : null;

  const recentVol = returns.length >= 20 ? std(returns.slice(-20)) : null;
  const longVol = returns.length >= 60 ? std(returns.slice(-60)) : null;
  features.return_std_ratio = recentVol && longVol && longVol > 0 ? recentVol / longVol : null;

  // Technical Indicators
  features.sma_20 = closes.length >= 20 ? mean(closes.slice(-20)) : null;
  features.sma_50 = closes.length >= 50 ? mean(closes.slice(-50)) : null;
  features.sma_200 = closes.length >= 200 ? mean(closes.slice(-200)) : null;

  const lastClose = closes[closes.length - 1];
  if (!lastClose) {
    return {
      asOfTime,
      symbol,
      timeframe,
      candleCount: validCandles.length,
      features: {},
      featureVersion: FEATURE_VERSION,
      dataQuality: 'insufficient',
    };
  }
  features.distance_sma_20 = features.sma_20 ? (lastClose - features.sma_20) / features.sma_20 : null;
  features.distance_sma_50 = features.sma_50 ? (lastClose - features.sma_50) / features.sma_50 : null;
  features.distance_sma_200 = features.sma_200 ? (lastClose - features.sma_200) / features.sma_200 : null;

  features.rsi_14 = computeRSI(closes, 14);

  const macdResult = computeMACD(closes);
  features.macd = macdResult.macd;
  features.macd_signal = macdResult.signal;
  features.macd_hist = macdResult.histogram;

  features.atr_14 = computeATR(highs, lows, closes, 14);
  features.atr_ratio = features.atr_14 ? features.atr_14 / lastClose : null;

  // Market Structure
  const swings = findSwings(highs, lows, 5);
  features.higher_highs = swings.higherHighs ? 1 : 0;
  features.higher_lows = swings.higherLows ? 1 : 0;

  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));
  features.distance_to_high = (lastClose - recentHigh) / recentHigh;
  features.distance_to_low = (lastClose - recentLow) / recentLow;

  // Volume
  const avgVolume = volumes.length >= 20 ? mean(volumes.slice(-20)) : null;
  const lastVolume = volumes[volumes.length - 1];
  features.volume_ratio = avgVolume && avgVolume > 0 && lastVolume !== undefined ? lastVolume / avgVolume : null;

  let quality: DataQuality = 'good';
  if (validCandles.length < 200) quality = 'degraded';
  const nullCount = Object.values(features).filter((v) => v === null).length;
  if (nullCount > Object.keys(features).length * 0.3) quality = 'degraded';

  return {
    asOfTime,
    symbol,
    timeframe,
    candleCount: validCandles.length,
    features,
    featureVersion: FEATURE_VERSION,
    dataQuality: quality,
  };
}

function computeReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev && prev > 0 && curr) {
      returns.push(Math.log(curr / prev));
    }
  }
  return returns;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function std(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computeRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const curr = closes[i];
    const prev = closes[i - 1];
    if (curr !== undefined && prev !== undefined) {
      changes.push(curr - prev);
    }
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change !== undefined) {
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    if (change !== undefined) {
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeMACD(closes: number[]): { macd: number | null; signal: number | null; histogram: number | null } {
  if (closes.length < 26) return { macd: null, signal: null, histogram: null };
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  if (ema12 === null || ema26 === null) return { macd: null, signal: null, histogram: null };
  const macd = ema12 - ema26;
  const signal = null; // Simplified: would need EMA of MACD line
  return { macd, signal, histogram: null };
}

function computeEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = mean(values.slice(0, period));
  if (ema === null) return null;
  for (let i = period; i < values.length; i++) {
    const value = values[i];
    if (value !== undefined) {
      ema = (value - ema) * multiplier + ema;
    }
  }
  return ema;
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number | null {
  if (highs.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    if (high !== undefined && low !== undefined && prevClose !== undefined) {
      tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
  }
  let atr = mean(tr.slice(0, period));
  if (atr === null) return null;
  for (let i = period; i < tr.length; i++) {
    const trVal = tr[i];
    if (trVal !== undefined) {
      atr = (atr * (period - 1) + trVal) / period;
    }
  }
  return atr;
}

function findSwings(highs: number[], lows: number[], lookback: number): { higherHighs: boolean; higherLows: boolean } {
  if (highs.length < lookback * 2) return { higherHighs: false, higherLows: false };
  const recentHighs = highs.slice(-lookback);
  const priorHighs = highs.slice(-lookback * 2, -lookback);
  const recentLows = lows.slice(-lookback);
  const priorLows = lows.slice(-lookback * 2, -lookback);
  return {
    higherHighs: Math.max(...recentHighs) > Math.max(...priorHighs),
    higherLows: Math.min(...recentLows) > Math.min(...priorLows),
  };
}

