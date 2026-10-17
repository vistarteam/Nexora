import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/types/domain.js';
import { sanitizeCandles } from '../src/services/marketData/types.js';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** A single plainly valid candle at `offset` hours after the fixed epoch. */
function candle(offsetHours: number, overrides: Partial<Candle> = {}): Candle {
  return {
    time: T0 + offsetHours * HOUR,
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 50,
    ...overrides,
  };
}

describe('sanitizeCandles', () => {
  describe('finite and strictly positive OHLCV', () => {
    it('keeps plainly valid candles untouched', () => {
      const input = [candle(0), candle(1), candle(2)];
      expect(sanitizeCandles(input)).toEqual(input);
    });

    it.each([
      ['open', 'open'],
      ['high', 'high'],
      ['low', 'low'],
      ['close', 'close'],
    ])('drops a candle with a non-finite %s', (_label, field) => {
      const bad = candle(0, { [field]: Number.NaN } as Partial<Candle>);
      const good = candle(1);
      const result = sanitizeCandles([bad, good]);
      expect(result).toEqual([good]);
    });

    it.each([
      ['zero open', { open: 0 }],
      ['negative high', { high: -1 }],
      ['negative low', { low: -5 }],
      ['zero close', { close: 0 }],
    ])('drops a candle with %s', (_label, overrides) => {
      const bad = candle(0, overrides);
      const good = candle(1);
      const result = sanitizeCandles([bad, good]);
      expect(result).toEqual([good]);
    });

    it('clamps a negative or non-finite volume to zero instead of dropping the candle', () => {
      const result = sanitizeCandles([
        candle(0, { volume: -25 }),
        candle(1, { volume: Number.NaN }),
        candle(2, { volume: Number.POSITIVE_INFINITY }),
      ]);
      expect(result.map((item) => item.volume)).toEqual([0, 0, 0]);
      expect(result).toHaveLength(3);
    });
  });

  describe('OHLC relationships', () => {
    it('drops a candle whose low exceeds its high', () => {
      const bad = candle(0, { high: 90, low: 110 });
      const good = candle(1);
      expect(sanitizeCandles([bad, good])).toEqual([good]);
    });

    it('drops a candle whose high does not bracket the close', () => {
      const bad = candle(0, { high: 101, close: 102 });
      const good = candle(1);
      expect(sanitizeCandles([bad, good])).toEqual([good]);
    });

    it('drops a candle whose low does not bracket the open', () => {
      const bad = candle(0, { low: 101, open: 100 });
      const good = candle(1);
      expect(sanitizeCandles([bad, good])).toEqual([good]);
    });

    it('accepts a flat candle where open, high, low and close are equal', () => {
      const flat = candle(0, { open: 100, high: 100, low: 100, close: 100 });
      expect(sanitizeCandles([flat])).toEqual([flat]);
    });
  });

  describe('timestamp units and validity', () => {
    it('drops timestamps expressed in seconds instead of milliseconds', () => {
      const seconds = candle(0);
      seconds.time = 1_700_000_000; // same instant, wrong unit
      const good = candle(1);
      expect(sanitizeCandles([seconds, good])).toEqual([good]);
    });

    it('drops timestamps expressed in microseconds or nanoseconds', () => {
      const good = candle(1);
      const micro = candle(0);
      micro.time = 1_700_000_000_000_000;
      const nano = candle(2);
      nano.time = 1_700_000_000_000_000_000;
      expect(sanitizeCandles([micro, good, nano])).toEqual([good]);
    });

    it.each([
      ['negative', { time: -1_700_000_000_000 }],
      ['zero', { time: 0 }],
      ['fractional', { time: T0 + 0.5 }],
    ])('drops a %s timestamp', (_label, overrides) => {
      const bad = candle(0, overrides);
      const good = candle(1);
      expect(sanitizeCandles([bad, good])).toEqual([good]);
    });

    it('accepts the earliest realistic millisecond epochs', () => {
      // 1e12 is exactly 2001-09-09T01:46:40Z, the documented lower bound.
      const oldest = candle(0, { time: 1e12 });
      const result = sanitizeCandles([oldest]);
      expect(result).toEqual([oldest]);
    });
  });

  describe('duplicate and out-of-order timestamps', () => {
    it('sorts candles ascending by time', () => {
      const result = sanitizeCandles([candle(2), candle(0), candle(1)]);
      expect(result.map((item) => item.time)).toEqual([
        T0,
        T0 + HOUR,
        T0 + 2 * HOUR,
      ]);
    });

    it('collapses repeated timestamps to the first occurrence', () => {
      const first = candle(0, { close: 100 });
      const duplicate = candle(0, { close: 999 });
      const result = sanitizeCandles([first, duplicate]);
      expect(result).toHaveLength(1);
      expect(result[0]!.close).toBe(100);
    });

    it('keeps every candle when all timestamps are distinct', () => {
      const input = [candle(0), candle(1), candle(2)];
      expect(sanitizeCandles(input)).toHaveLength(3);
    });
  });

  describe('filter contract', () => {
    it('returns an empty array when every candle is invalid', () => {
      expect(sanitizeCandles([candle(0, { open: -1 }), candle(1, { low: 500 })])).toEqual([]);
    });

    it('preserves a mix of valid and invalid rows, dropping only the bad ones', () => {
      const result = sanitizeCandles([
        candle(0, { high: 50, low: 60 }), // invalid
        candle(1), // valid
        candle(1), // duplicate of the previous timestamp
        candle(2, { time: 1_700 }), // wrong unit
        candle(3), // valid
      ]);
      expect(result.map((item) => item.time)).toEqual([
        T0 + HOUR,
        T0 + 3 * HOUR,
      ]);
    });
  });
});
