import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/types/domain.js';
import { atr, ema, macd, rsi, sma } from '../src/services/analysis/reference/indicators.js';
import {
  analyzeCandles,
  decodeCandles,
  requiredCandleCount,
} from '../src/services/analysis/reference/index.js';
import {
  TREND_T_THRESHOLD,
  classifyTrend,
  slopeTStatistic,
} from '../src/services/analysis/reference/trend.js';
import { DEFAULT_ENGINE_OPTIONS } from '../src/services/analysis/types.js';

function makeCandles(count: number, drift = 0, amplitude = 0): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const wave = amplitude * Math.sin((2 * Math.PI * index) / 20);
    const open = price;
    const close = Math.max(0.01, price * (1 + drift) + wave * 0.1);
    candles.push({
      time: 1_700_000_000_000 + index * 3_600_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1000,
    });
    price = close;
  }
  return candles;
}

/** A realistic epoch-millisecond open time; the decoder accepts only this unit. */
const T0 = 1_700_000_000_000;

/** A well-formed candle at `T0 + index` hours, with fields overridden. */
function candle(index: number, overrides: Partial<Candle> = {}): Candle {
  return {
    time: T0 + index * 3_600_000,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
    ...overrides,
  };
}

describe('reference indicators', () => {
  it('computes a simple moving average with the expected warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('seeds the EMA with the SMA of the first window', () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result[2]).toBeCloseTo(2);
    expect(result[3]).toBeCloseTo(3);
    expect(result[4]).toBeCloseTo(4);
  });

  it('keeps RSI inside 0..100 and pins the extremes', () => {
    const rising = Array.from({ length: 60 }, (_, index) => index + 1);
    expect(rsi(rising, 14).at(-1)).toBeCloseTo(100, 6);

    const falling = Array.from({ length: 60 }, (_, index) => 60 - index);
    expect(rsi(falling, 14).at(-1)).toBeCloseTo(0, 6);

    for (const value of rsi(rising, 14)) {
      if (value !== null) expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves RSI undefined until index `period`', () => {
    const values = rsi(Array.from({ length: 40 }, (_, index) => index + 1), 14);
    expect(values[13]).toBeNull();
    expect(values[14]).not.toBeNull();
  });

  it('produces a zero MACD on a flat series', () => {
    const series = macd(new Array(80).fill(50));
    expect(series.macd.at(-1)).toBeCloseTo(0, 9);
    expect(series.histogram.at(-1)).toBeCloseTo(0, 9);
  });

  it('keeps histogram equal to macd minus signal', () => {
    const closes = Array.from({ length: 150 }, (_, index) => 100 + Math.sqrt(index) * 3);
    const series = macd(closes);
    const macdValue = series.macd.at(-1)!;
    const signalValue = series.signal.at(-1)!;
    expect(series.histogram.at(-1)).toBeCloseTo(macdValue - signalValue, 9);
  });

  it('computes a constant ATR for a constant range', () => {
    const highs = new Array(30).fill(10);
    const lows = new Array(30).fill(9);
    const closes = new Array(30).fill(9.5);
    expect(atr(highs, lows, closes, 14).at(-1)).toBeCloseTo(1, 6);
  });
});

describe('decodeCandles', () => {
  it('rejects a non-array payload', () => {
    expect(() => decodeCandles({ nope: true })).toThrow();
  });

  it('skips malformed entries and warns about them', () => {
    const { candles, warnings } = decodeCandles([
      candle(0),
      { ...candle(1), open: 'x' },
      'junk',
      candle(2),
    ]);
    expect(candles).toHaveLength(2);
    expect(warnings.join(' ')).toContain('نادیده');
  });

  it('keeps the first occurrence of a duplicate timestamp', () => {
    const { candles, warnings } = decodeCandles([candle(0), { ...candle(0), high: 3, close: 2.5 }]);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe(1.5);
    expect(warnings.join(' ')).toContain('تکراری');
  });

  it('drops candles whose high/low do not bracket open/close instead of repairing them', () => {
    const { candles, warnings } = decodeCandles([candle(0, { open: 5, high: 2, low: 9, close: 6 })]);
    expect(candles).toHaveLength(0);
    expect(warnings.join(' ')).toContain('نادیده');
  });

  it('drops a candle whose high is below its close', () => {
    const { candles, warnings } = decodeCandles([candle(0, { high: 1.2 })]);
    expect(candles).toHaveLength(0);
    expect(warnings.join(' ')).toContain('نادیده');
  });

  it('rejects timestamps in the wrong unit', () => {
    const { candles, warnings } = decodeCandles([
      candle(0, { time: 1_700_000_000 }),
      candle(1, { time: 1_700_000_000_000_000 }),
      candle(2, { time: 1_700_000_000_000_000_000 }),
    ]);
    expect(candles).toHaveLength(0);
    expect(warnings.join(' ')).toContain('نادیده');
  });

  it('drops non-finite prices', () => {
    const { candles, warnings } = decodeCandles([
      candle(0, { high: Number.NaN }),
      candle(1, { low: Number.POSITIVE_INFINITY }),
    ]);
    expect(candles).toHaveLength(0);
    expect(warnings.join(' ')).toContain('نادیده');
  });

  it('clamps a negative volume to zero', () => {
    const { candles } = decodeCandles([candle(0, { volume: -5 })]);
    expect(candles).toHaveLength(1);
    expect(candles[0]!.volume).toBe(0);
  });

  it('defaults volume to zero when it is missing or unparseable', () => {
    const { candles } = decodeCandles([candle(0), { ...candle(1), volume: 'not-a-number' }]);
    expect(candles).toHaveLength(2);
    expect(candles.map((entry) => entry.volume)).toEqual([1, 0]);
  });

  it('sorts ascending by time', () => {
    const { candles } = decodeCandles([candle(3), candle(1)]);
    expect(candles.map((entry) => entry.time)).toEqual([T0 + 3_600_000, T0 + 10_800_000]);
  });
});

describe('analyzeCandles', () => {
  it('reports unavailable with no usable candles and invents nothing', () => {
    const result = analyzeCandles([]);
    expect(result.status).toBe('unavailable');
    expect(result.facts).toBeNull();
    expect(result.interpretation).toBeNull();
    expect(result.scenarios).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it('reports insufficient_data without producing conclusions', () => {
    const result = analyzeCandles(makeCandles(20));
    expect(result.status).toBe('insufficient_data');
    expect(result.facts).toBeNull();
    expect(result.reason).toContain('کندل');
  });

  it('reports ok with full facts once enough candles are supplied', () => {
    const result = analyzeCandles(makeCandles(300, 0.001, 2));
    expect(result.status).toBe('ok');
    expect(result.facts?.candleCount).toBe(300);
    expect(result.facts?.indicators.rsi).not.toBeNull();
    expect(result.interpretation?.summary).toBeTruthy();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('orders levels by real distance, nearest first', () => {
    const result = analyzeCandles(makeCandles(300, 0.001, 2));
    const levels = result.facts?.levels;
    expect(levels).not.toBeNull();
    const supports = levels?.supports ?? [];
    const resistances = levels?.resistances ?? [];

    const supportDistances = supports.map((level) => level.distancePercent);
    const resistanceDistances = resistances.map((level) => level.distancePercent);
    expect(supportDistances).toEqual([...supportDistances].sort((a, b) => b - a));
    expect(resistanceDistances).toEqual([...resistanceDistances].sort((a, b) => a - b));

    if (supports.length > 0) expect(levels?.nearestSupport).toBe(supports[0]);
    if (resistances.length > 0) expect(levels?.nearestResistance).toBe(resistances[0]);
  });

  it('labels the whole-series and trend-window volatilities with their windows', () => {
    const result = analyzeCandles(makeCandles(300, 0.001, 2));
    const volatilityReading = result.interpretation?.volatilityReading ?? '';
    expect(volatilityReading).toContain('انحراف معیار ساده روی کل 300 کندل');

    const volatilityLine = result.facts?.trend.evidence.find((line) =>
      line.includes('نوسان بازده‌ها'),
    );
    expect(volatilityLine).toBeTruthy();
    expect(volatilityLine).toContain('انحراف معیار روی آخرین 90 کندل روند');
    // The trend line must not reuse the whole-series label, so the two figures
    // stay distinguishable inside the same report.
    expect(volatilityLine).not.toContain('ساده روی کل');
  });

  it('records the fallback engine id', () => {
    const result = analyzeCandles(makeCandles(300, 0.001, 2));
    expect(result.engine.id).toBe('typescript-fallback');
  });

  it('is deterministic for identical input', () => {
    const first = analyzeCandles(makeCandles(300, 0.001, 2));
    const second = analyzeCandles(makeCandles(300, 0.001, 2));
    expect(second.facts?.indicators.rsi).toEqual(first.facts?.indicators.rsi);
    expect(second.scenarios).toEqual(first.scenarios);
  });

  it('gives every scenario an invalidation condition', () => {
    const result = analyzeCandles(makeCandles(300, 0.001, 2));
    for (const scenario of result.scenarios) {
      expect(scenario.condition.length).toBeGreaterThan(0);
      expect(scenario.invalidation.length).toBeGreaterThan(0);
    }
  });

  it('requires more candles for a longer SMA', () => {
    const longer = requiredCandleCount({ ...DEFAULT_ENGINE_OPTIONS, smaPeriods: [500] });
    expect(longer).toBeGreaterThan(requiredCandleCount());
  });
});

describe('trend classification', () => {
  /** Build a close series with a given per-bar drift and a sine wave on top. */
  function series(count: number, drift: number, amplitude: number) {
    return makeCandles(count, drift, amplitude);
  }

  function read(candles: Candle[]) {
    return classifyTrend(
      candles.map((candle) => candle.high),
      candles.map((candle) => candle.low),
      candles.map((candle) => candle.close),
    );
  }

  it('classifies a flat series as sideways with zero strength', () => {
    const reading = read(series(300, 0, 0));
    expect(reading.direction).toBe('sideways');
    expect(reading.strength).toBe(0);
  });

  it('classifies pure noise as sideways', () => {
    const reading = read(series(300, 0, 3));
    expect(reading.direction).toBe('sideways');
    expect(reading.strength).toBeLessThan(20);
  });

  it('classifies a steady rise as an uptrend with a large t-statistic', () => {
    const reading = read(series(300, 0.0015, 2));
    expect(reading.direction).toBe('uptrend');
    expect(reading.tStatistic).toBeGreaterThan(TREND_T_THRESHOLD);
    expect(reading.strength).toBeGreaterThan(50);
  });

  it('classifies a steady fall as a downtrend', () => {
    const reading = read(series(300, -0.0015, 2));
    expect(reading.direction).toBe('downtrend');
    expect(reading.tStatistic).toBeLessThan(-TREND_T_THRESHOLD);
  });

  it('reports an infinite t-statistic for a perfectly linear series instead of guessing', () => {
    const { slope, t } = slopeTStatistic([1, 2, 3, 4, 5]);
    expect(slope).toBeCloseTo(1, 12);
    expect(t).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports a zero t-statistic for a perfectly flat series', () => {
    const { slope, t } = slopeTStatistic([5, 5, 5, 5, 5]);
    expect(slope).toBe(0);
    expect(t).toBe(0);
  });

  it('gives strength headroom rather than saturating on every trend', () => {
    const mild = read(series(300, 0.0005, 2));
    const strong = read(series(300, 0.004, 2));
    expect(mild.direction).toBe('uptrend');
    expect(mild.strength).toBeLessThan(strong.strength ?? 0);
  });

  it('reports unknown when there is not enough data', () => {
    const reading = classifyTrend([1, 2], [0.5, 1.5], [1, 2]);
    expect(reading.direction).toBe('unknown');
    expect(reading.strength).toBeNull();
  });
});
