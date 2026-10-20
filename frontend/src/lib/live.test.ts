import { describe, expect, it } from 'vitest';
import type { Candle, TickerSnapshot } from '../types/nexora';
import {
  MAX_LIVE_CANDLES,
  describeLiveCandle,
  describeLiveClose,
  formatClock,
  formatCountdown,
  mergeLiveCandle,
} from './live';

function candle(time: number, close = 100): Candle {
  return { time, open: close - 1, high: close + 1, low: close - 2, close, volume: 5 };
}

function snapshot(overrides: Partial<TickerSnapshot> = {}): TickerSnapshot {
  return {
    symbol: 'BINANCE:BTCUSDT',
    tvSymbol: 'BINANCE:BTCUSDT',
    assetClass: 'crypto',
    timeframe: '1h',      price: 100,
      candle: candle(1_700_000_000_000),
    candleOpenTime: 1_700_000_000_000,
    candleCloseTime: 1_700_003_600_000,
    candleCloseAt: new Date(1_700_003_600_000).toISOString(),
    secondsToClose: 3600,
    dataSource: 'nobitex',
    mode: 'live',
    fetchedAt: new Date(1_700_000_000_000).toISOString(),
    freshness: {
      transport: 'websocket',
      venue: 'nobitex',
      priceDefinition: 'last_trade',
      eventTime: 1_700_000_000_000,
      receivedAt: 1_700_000_000_000,
      lastRestSyncAt: 1_700_000_000_000,
      connection: 'connected',
      ageMs: 0,
      staleAfterMs: 10_000,
      isStale: false,
      lastError: null,
      warnings: [],
    },
    ...overrides,
  };
}

describe('mergeLiveCandle', () => {
  it('replaces the forming bar when the open time is unchanged', () => {
    const series = [candle(1_000), candle(2_000, 100)];
    const merged = mergeLiveCandle(series, candle(2_000, 111));

    expect(merged).toHaveLength(2);
    expect(merged[1]!.close).toBe(111);
    // The earlier bar is untouched.
    expect(merged[0]!.close).toBe(100);
  });

  it('appends a genuinely new period', () => {
    const merged = mergeLiveCandle([candle(1_000), candle(2_000)], candle(3_000, 120));

    expect(merged).toHaveLength(3);
    expect(merged[2]!.time).toBe(3_000);
    expect(merged[2]!.close).toBe(120);
  });

  it('ignores a stale bar, so a slow poll cannot walk the series backwards', () => {
    const series = [candle(1_000), candle(2_000)];
    expect(mergeLiveCandle(series, candle(1_000, 999))).toBe(series);
  });

  it('seeds an empty series with the live bar', () => {
    const merged = mergeLiveCandle([], candle(5_000, 77));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.close).toBe(77);
  });

  it('does not mutate the input array', () => {
    const series = [candle(1_000), candle(2_000)];
    const before = series.map((item) => item.close);
    mergeLiveCandle(series, candle(2_000, 123));
    expect(series.map((item) => item.close)).toEqual(before);
  });

  it('caps a long-running session at the configured maximum', () => {
    const series = Array.from({ length: MAX_LIVE_CANDLES }, (_, index) => candle(index * 1_000));
    const merged = mergeLiveCandle(series, candle(MAX_LIVE_CANDLES * 1_000));
    expect(merged).toHaveLength(MAX_LIVE_CANDLES);
    // The oldest bar is dropped, the newest kept.
    expect(merged[0]!.time).toBe(1_000);
  });
});

describe('formatCountdown', () => {
  it('renders hours, minutes and seconds', () => {
    expect(formatCountdown(3661, 'en')).toBe('1:01:01');
    expect(formatCountdown(59, 'en')).toBe('0:00:59');
  });

  it('does not wrap hours at 24, so a daily bar counts down from 24', () => {
    expect(formatCountdown(86_400, 'en')).toBe('24:00:00');
    expect(formatCountdown(604_800, 'en')).toBe('168:00:00');
  });

  it('clamps an overdue bar to zero instead of showing a deficit', () => {
    expect(formatCountdown(-30, 'en')).toBe('0:00:00');
  });

  it('uses Persian digits when asked', () => {
    expect(formatCountdown(3661, 'fa')).toBe('۱:۰۱:۰۱');
  });

  it('returns a dash for missing input', () => {
    expect(formatCountdown(null, 'en')).toBe('—');
    expect(formatCountdown(undefined, 'en')).toBe('—');
    expect(formatCountdown(Number.NaN, 'en')).toBe('—');
  });
});

describe('formatClock', () => {
  it('formats an ISO instant as a local time of day', () => {
    const date = new Date(2026, 9, 14, 17, 30, 5);
    expect(formatClock(date.toISOString(), 'en')).toBe('17:30:05');
  });

  it('returns a dash for missing or malformed input', () => {
    expect(formatClock(null, 'en')).toBe('—');
    expect(formatClock('not-a-date', 'en')).toBe('—');
  });

  it('uses Persian digits when asked', () => {
    const date = new Date(2026, 9, 14, 9, 5, 3);
    expect(formatClock(date.toISOString(), 'fa')).toBe('۰۹:۰۵:۰۳');
  });
});

describe('describeLiveCandle', () => {
  it('states the close time and the remaining time', () => {
    const text = describeLiveCandle(snapshot(), 3600, 'en');
    expect(text).toContain('1:00:00');
    expect(text).toContain('بسته‌شدن کندل');
  });

  it('degrades gracefully without a snapshot', () => {
    expect(describeLiveCandle(null, null, 'en')).toBe('بدون داده زنده');
  });
});

describe('describeLiveClose', () => {
  it('keeps the scale label short: time and remaining seconds only', () => {
    // Built from a local instant so the expectation does not depend on the
    // machine's timezone.
    const local = new Date(2026, 9, 14, 17, 30, 5);
    const text = describeLiveClose(
      snapshot({ candleCloseTime: local.getTime(), candleCloseAt: local.toISOString() }),
      3600,
      'en',
    );
    expect(text).toBe('بستن 17:30:05 · 1:00:00');
  });

  it('produces nothing when there is no snapshot', () => {
    expect(describeLiveClose(null, null, 'en')).toBe('');
  });
});
