import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Candle, Timeframe } from '../src/types/domain.js';
import {
  storeCandles,
  fetchHistoricalCandles,
  assessDataQuality,
  getDataset,
  clearAllData,
  listDatasets,
} from '../src/services/data/historicalDataService.js';
import { extractFeatures } from '../src/services/forecasting/featureEngineering.js';
import { generateForecast, classifyRegime } from '../src/services/forecasting/forecastService.js';
import { generateBaselineForecast } from '../src/services/forecasting/baselineModels.js';

/**
 * Build a synthetic candle series for testing.
 */
function makeCandles(count: number, startPrice = 100, timeframeMs = 60 * 60 * 1000): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const startTime = Date.now() - count * timeframeMs;
  for (let i = 0; i < count; i++) {
    price = price * (1 + 0.0005 + (Math.random() - 0.5) * 0.01);
    candles.push({
      time: startTime + i * timeframeMs,
      open: price * 0.999,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1000 + Math.random() * 500,
    });
  }
  return candles;
}

// ----- Historical Data Service -----

describe('historicalDataService', () => {
  beforeEach(clearAllData);
  afterEach(clearAllData);

  it('stores candles with deduplication', () => {
    const candles = makeCandles(10);
    const first = storeCandles({ symbol: 'BTCUSDT', timeframe: '1h', candles, source: 'test' });
    expect(first.added).toBe(10);
    expect(first.deduplicated).toBe(0);

    const second = storeCandles({ symbol: 'BTCUSDT', timeframe: '1h', candles: candles.slice(5), source: 'test' });
    expect(second.added).toBe(0);
    expect(second.deduplicated).toBe(5);
  });

  it('queries candles within a time range', () => {
    const candles = makeCandles(50, 100, 60 * 60 * 1000);
    storeCandles({ symbol: 'BTCUSDT', timeframe: '1h', candles, source: 'test' });

    const query = fetchHistoricalCandles({ symbol: 'BTCUSDT', timeframe: '1h', limit: 10 });
    expect(query.length).toBe(10);
    expect(query[0]!.time).toBe(candles[40]!.time);
  });

  it('tracks dataset metadata', () => {
    const candles = makeCandles(300);
    storeCandles({ symbol: 'BTCUSDT', timeframe: '1h', candles, source: 'test' });

    const dataset = getDataset('BTCUSDT', '1h');
    expect(dataset).not.toBeNull();
    expect(dataset!.candleCount).toBe(300);
    expect(listDatasets().length).toBe(1);
  });

  it('reports insufficient quality with no data', () => {
    const report = assessDataQuality({ symbol: 'BTCUSDT', timeframe: '1h' });
    expect(report.quality).toBe('insufficient');
    expect(report.candleCount).toBe(0);
  });
});

// ----- Feature Engineering -----

describe('featureEngineering', () => {
  it('extracts features with no future peeking', () => {
    const candles = makeCandles(300);
    const asOfTime = candles[199]!.time;

    const featureSet = extractFeatures({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      candles,
      asOfTime,
    });

    expect(featureSet.candleCount).toBe(200);
    expect(featureSet.features.return_1).not.toBeNull();
    expect(featureSet.features.rsi_14).not.toBeNull();
    expect(featureSet.features.sma_20).not.toBeNull();
    expect(featureSet.features.distance_sma_200).not.toBeNull();
    expect(featureSet.featureVersion).toBe('v1.1.0');
  });

  it('returns insufficient quality for too little data', () => {
    const candles = makeCandles(30);
    const featureSet = extractFeatures({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      candles,
      asOfTime: candles[29]!.time,
    });
    expect(featureSet.dataQuality).toBe('insufficient');
    expect(Object.keys(featureSet.features).length).toBe(0);
  });

  it('computes RSI within valid range [0, 100]', () => {
    const candles = makeCandles(100);
    const featureSet = extractFeatures({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      candles,
      asOfTime: candles[99]!.time,
    });
    const rsi = featureSet.features.rsi_14;
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });
});

// ----- Baseline Models -----

describe('baselineModels', () => {
  it('zero model predicts 0% return / neutral', () => {
    const candles = makeCandles(50);
    const forecast = generateBaselineForecast({
      model: 'zero',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      horizon: '1h',
      candles,
    });
    expect(forecast.predictedReturn).toBe(0);
    expect(forecast.predictedDirection).toBe('neutral');
    expect(forecast.referencePrice).toBeGreaterThan(0);
  });

  it('momentum model produces a defined forecast', () => {
    const candles = makeCandles(100);
    const forecast = generateBaselineForecast({
      model: 'momentum',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      horizon: '1h',
      candles,
    });
    expect(forecast.predictedReturn).not.toBeNaN();
    expect(['up', 'down', 'neutral']).toContain(forecast.predictedDirection);
  });
});

// ----- Forecast Service -----

describe('forecastService', () => {
  it('generates a complete multi-horizon forecast', () => {
    const candles = makeCandles(300);
    const forecast = generateForecast({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      candles,
      horizons: ['15m', '1h', '4h'],
    });

    expect(forecast.symbol).toBe('BTCUSDT');
    expect(forecast.horizons.length).toBe(3);
    expect(forecast.referencePrice).toBeGreaterThan(0);
    expect(forecast.id).toBeTruthy();
    expect(forecast.model.id).toBe('momentum');
    expect(['good', 'degraded', 'insufficient']).toContain(forecast.dataQuality);
    expect(forecast.horizons[0]!.expiresInMs).toBeLessThan(forecast.horizons[2]!.expiresInMs);
  });

  it('classifies market regime', () => {
    const upFeatures = { distance_sma_50: 0.02, distance_sma_200: 0.01, return_std_ratio: 0.8 };
    expect(classifyRegime(upFeatures)).toBe('uptrend');

    const downFeatures = { distance_sma_50: -0.02, distance_sma_200: -0.03, return_std_ratio: 0.8 };
    expect(classifyRegime(downFeatures)).toBe('downtrend');

    const volatileFeatures = { return_std_ratio: 2.0 };
    expect(classifyRegime(volatileFeatures)).toBe('high_volatility');

    expect(classifyRegime({})).toBe('unknown');
  });

  it('produces warnings on insufficient data', () => {
    const candles = makeCandles(30);
    const forecast = generateForecast({ symbol: 'BTCUSDT', timeframe: '1h', candles });
    expect(forecast.dataQuality).toBe('insufficient');
    expect(forecast.warnings.length).toBeGreaterThan(0);
  });
});


describe('forecasting safety and probability outputs', () => {
  it('excludes forming candles and candles ingested after the as-of time', () => {
    const candles = makeCandles(80) as (Candle & { isClosed?: boolean; ingestedAt?: number })[];
    const cutoff = candles[69]!.time;
    candles[10]!.ingestedAt = cutoff + 1;
    candles[69]!.isClosed = false;
    const features = extractFeatures({ symbol: 'BTCUSDT', timeframe: '1h', candles, asOfTime: cutoff });
    expect(features.candleCount).toBe(68);
    expect(features.features.return_1).not.toBeNull();
  });

  it('does not change point-in-time features when future candles are appended', () => {
    const candles = makeCandles(100);
    const cutoff = candles[79]!.time;
    const a = extractFeatures({ symbol: 'BTCUSDT', timeframe: '1h', candles: candles.slice(0, 80), asOfTime: cutoff });
    const b = extractFeatures({ symbol: 'BTCUSDT', timeframe: '1h', candles, asOfTime: cutoff });
    expect(b.features).toEqual(a.features);
  });

  it('returns bounded directional probabilities and uncertainty interval when volatility exists', () => {
    const candles = makeCandles(300);
    const forecast = generateForecast({ symbol: 'BTCUSDT', timeframe: '1h', candles, horizons: ['15m', '1h', '4h'] });
    for (const h of forecast.horizons) {
      expect(h.directionProb.up).toBeGreaterThanOrEqual(0);
      expect(h.directionProb.up).toBeLessThanOrEqual(1);
      expect((h.directionProb.up ?? 0) + (h.directionProb.down ?? 0) + (h.directionProb.neutral ?? 0)).toBeCloseTo(1, 2);
      expect(h.returnForecast.point).not.toBeNull();
    }
    expect(forecast.warnings.some(w => w.includes('not calibrated'))).toBe(true);
  });
});
