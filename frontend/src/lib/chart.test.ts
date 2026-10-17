import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DRAWINGS,
  buildLevelLines,
  buildSwingMarkers,
  buildTrendLine,
  createDrawingId,
  drawingKey,
  hasVolume,
  loadDrawings,
  overlayColor,
  saveDrawings,
  toCandlestickData,
  toChartTime,
  toHistogramData,
  toLineData,
  windowChangePercent,
} from './chart';
import { createMemoryStorageAdapter, setStorage } from './storage';
import type { Candle, ChartPayload, SupportResistanceLevel } from '../types/nexora';

const T0 = 1_700_000_000_000;

function candle(index: number, overrides: Partial<Candle> = {}): Candle {
  return {
    time: T0 + index * 3_600_000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 10 + index,
    ...overrides,
  };
}

function level(price: number, overrides: Partial<SupportResistanceLevel> = {}): SupportResistanceLevel {
  return { price, touches: 2, distancePercent: 1, kind: 'swing', ...overrides };
}

function payload(overrides: Partial<ChartPayload> = {}): ChartPayload {
  return {
    symbol: 'BINANCE:BTCUSDT',
    tvSymbol: 'BINANCE:BTCUSDT',
    name: 'بیت‌کوین / تتر',
    assetClass: 'crypto',
    timeframe: '1h',
    generatedAt: new Date(T0).toISOString(),
    mode: 'live',
    dataSource: 'test',
    engine: { id: 'python', name: 'nexora-analysis-engine', version: '0.3.0' },
    status: 'ok',
    reason: null,
    warnings: [],
    candles: [candle(0), candle(1), candle(2)],
    overlays: [
      { id: 'ema9', kind: 'ema', period: 9, points: [{ time: T0, value: 100 }] },
      { id: 'sma20', kind: 'sma', period: 20, points: [{ time: T0, value: 99 }] },
    ],
    indicators: {
      rsi: { period: 14, overbought: 70, oversold: 30, points: [{ time: T0, value: 55 }] },
      macd: {
        fast: 12,
        slow: 26,
        signalPeriod: 9,
        macd: [{ time: T0, value: 1.5 }],
        signal: [{ time: T0, value: 1 }],
        histogram: [
          { time: T0, value: 0.5 },
          { time: T0 + 3_600_000, value: -0.5 },
        ],
      },
      atr: { period: 14, points: [{ time: T0, value: 2 }] },
    },
    levels: {
      supports: [level(98, { distancePercent: -2 }), level(95, { distancePercent: -5 })],
      resistances: [level(105, { distancePercent: 5 }), level(102, { distancePercent: 2 })],
      nearestSupport: level(98, { distancePercent: -2 }),
      nearestResistance: level(102, { distancePercent: 2 }),
    },
    swings: {
      highs: [{ time: T0 + 3_600_000, value: 103 }],
      lows: [{ time: T0, value: 99 }],
    },
    trend: {
      direction: 'uptrend',
      strength: 42,
      regression: {
        from: { time: T0, value: 99 },
        to: { time: T0 + 7_200_000, value: 103 },
      },
    },
    ...overrides,
  };
}

describe('chart time conversion', () => {
  it('converts epoch milliseconds to the seconds the library expects', () => {
    expect(toChartTime(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('truncates sub-second milliseconds rather than rounding up to the next bar', () => {
    expect(toChartTime(1_700_000_000_999)).toBe(1_700_000_000);
  });

  it('applies the same conversion to candles and to indicator points', () => {
    const [first] = toCandlestickData([candle(0)]);
    expect(first).toEqual({
      time: 1_700_000_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
    });

    expect(toLineData([{ time: T0, value: 12 }])).toEqual([{ time: 1_700_000_000, value: 12 }]);
  });
});

describe('line and histogram data', () => {
  it('drops non-finite points instead of plotting gaps', () => {
    const points = [
      { time: T0, value: 1 },
      { time: Number.NaN, value: 2 },
      { time: T0 + 1, value: Number.POSITIVE_INFINITY },
      { time: T0 + 2, value: 3 },
    ];
    expect(toLineData(points)).toHaveLength(2);
  });

  it('colours histogram bars by the sign of the value', () => {
    const data = toHistogramData(
      [
        { time: T0, value: 1 },
        { time: T0 + 3_600_000, value: -1 },
      ],
      { positive: '#0f0', negative: '#f00' },
    );
    expect(data.map((point) => point.color)).toEqual(['#0f0', '#f00']);
  });
});

describe('overlay colours', () => {
  it('is deterministic and never returns undefined', () => {
    expect(overlayColor(0)).toBe(overlayColor(0));
    expect(overlayColor(0)).not.toBe(overlayColor(1));
    expect(overlayColor(50)).toBeTruthy();
  });
});

describe('levels', () => {
  it('marks the nearest level on each side of the price', () => {
    const lines = buildLevelLines(payload());
    const nearest = lines.filter((line) => line.nearest);
    expect(nearest).toHaveLength(2);
    expect(nearest.map((line) => line.price).sort((a, b) => a - b)).toEqual([98, 102]);
    expect(nearest.find((line) => line.price === 98)?.kind).toBe('support');
    expect(nearest.find((line) => line.price === 102)?.kind).toBe('resistance');
  });

  it('keeps every detected level, labelled by side', () => {
    const lines = buildLevelLines(payload());
    expect(lines.filter((line) => line.kind === 'support')).toHaveLength(2);
    expect(lines.filter((line) => line.kind === 'resistance')).toHaveLength(2);
  });

  it('returns nothing when the engine detected no levels', () => {
    expect(buildLevelLines(payload({ levels: null }))).toEqual([]);
  });
});

describe('swings and trend line', () => {
  it('places swing markers above highs and below lows, in ascending time', () => {
    const markers = buildSwingMarkers(payload(), { bull: '#0f0', bear: '#f00' });
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ position: 'belowBar', shape: 'arrowUp', time: 1_700_000_000 });
    expect(markers[1]).toMatchObject({ position: 'aboveBar', shape: 'arrowDown' });
    expect((markers[0]?.time as number) < (markers[1]?.time as number)).toBe(true);
  });

  it('plots both endpoints of the fitted trend line', () => {
    expect(buildTrendLine(payload())).toEqual([
      { time: 1_700_000_000, value: 99 },
      { time: 1_700_007_200, value: 103 },
    ]);
  });

  it('draws no trend line when the engine fitted none', () => {
    expect(buildTrendLine(payload({ trend: null }))).toEqual([]);
  });
});

describe('candle-derived helpers', () => {
  it('reports whether the venue supplies volume at all', () => {
    expect(hasVolume([candle(0)])).toBe(true);
    expect(hasVolume([candle(0, { volume: 0 }), candle(1, { volume: 0 })])).toBe(false);
  });

  it('measures the change across the window', () => {
    const candles = [candle(0, { close: 100 }), candle(1, { close: 110 })];
    expect(windowChangePercent(candles)).toBeCloseTo(10, 6);
    expect(windowChangePercent([])).toBeNull();
  });
});

describe('user drawings', () => {
  beforeEach(() => {
    setStorage(createMemoryStorageAdapter());
  });

  it('round-trips drawings per symbol and timeframe', () => {
    saveDrawings('BINANCE:BTCUSDT', '1h', [{ id: 'a', kind: 'hline', price: 100 }]);
    saveDrawings('BINANCE:ETHUSDT', '1h', [{ id: 'b', kind: 'hline', price: 5 }]);

    expect(loadDrawings('BINANCE:BTCUSDT', '1h')).toEqual([{ id: 'a', kind: 'hline', price: 100 }]);
    expect(loadDrawings('BINANCE:ETHUSDT', '1h')).toEqual([{ id: 'b', kind: 'hline', price: 5 }]);
    expect(loadDrawings('BINANCE:BTCUSDT', '4h')).toEqual([]);
  });

  it('caps how many drawings one instrument can accumulate', () => {
    const many = Array.from({ length: MAX_DRAWINGS + 10 }, (_, index) => ({
      id: `d${index}`,
      kind: 'hline' as const,
      price: index,
    }));
    const stored = saveDrawings('X', '1h', many);
    expect(stored).toHaveLength(MAX_DRAWINGS);
    expect(stored[stored.length - 1]?.id).toBe(`d${MAX_DRAWINGS + 9}`);
  });

  it('keys drawings by symbol and timeframe', () => {
    expect(drawingKey('X', '1h')).not.toBe(drawingKey('X', '4h'));
  });

  it('generates unique ids', () => {
    expect(createDrawingId('hline', 1)).not.toBe(createDrawingId('hline', 1));
  });
});
