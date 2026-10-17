import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { BinanceMarketDataProvider } from '../src/services/marketData/binanceProvider.js';
import { MarketDataError } from '../src/services/marketData/types.js';

const FIXED_NOW = 1_700_000_000_000;

const baseRequest = {
  symbol: 'BINANCE:BTCUSDT',
  tvSymbol: 'BINANCE:BTCUSDT',
  assetClass: 'crypto' as const,
  timeframe: '1h' as const,
  limit: 100,
};

function createMockKlineRow(
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
): [number, string, string, string, string, string, number, number, number, number, number, string] {
  return [
    openTime,
    open,
    high,
    low,
    close,
    volume,
    Number(volume) * Number(close),
    0,
    0,
    0,
    0,
    '0',
  ];
}

const sampleKlines = [
  createMockKlineRow(FIXED_NOW - 7200000, '63000', '63500', '62500', '63200', '100'),
  createMockKlineRow(FIXED_NOW - 3600000, '63200', '63800', '63000', '63600', '120'),
  createMockKlineRow(FIXED_NOW, '63600', '64000', '63400', '63800', '110'),
];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('BinanceMarketDataProvider', () => {
  function provider(baseUrl?: string) {
    return new BinanceMarketDataProvider({ baseUrl });
  }

  describe('successful response parsing', () => {
    it('parses Binance kline response into CandleSeries with correct fields', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.source.provider).toBe('binance');
      expect(series.source.mode).toBe('live');
      expect(series.symbol).toBe('BINANCE:BTCUSDT');
      expect(series.tvSymbol).toBe('BINANCE:BTCUSDT');
      expect(series.assetClass).toBe('crypto');
      expect(series.timeframe).toBe('1h');
      expect(series.candles).toHaveLength(3);

      const first = series.candles[0]!;
      expect(first.time).toBe(FIXED_NOW - 7200000);
      expect(first.open).toBe(63000);
      expect(first.high).toBe(63500);
      expect(first.low).toBe(62500);
      expect(first.close).toBe(63200);
      expect(first.volume).toBe(100);

      const last = series.candles[2]!;
      expect(last.time).toBe(FIXED_NOW);
      expect(last.close).toBe(63800);
    });

    it('rounds USDT pair prices to 2 decimals', async () => {
      const klinesWithDecimals = [
        createMockKlineRow(FIXED_NOW, '63000.12345678', '63500.98765432', '62500.11111111', '63200.55555555', '100.999'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => klinesWithDecimals,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles[0]!.open).toBe(63000.12);
      expect(series.candles[0]!.high).toBe(63500.99);
      expect(series.candles[0]!.low).toBe(62500.11);
      expect(series.candles[0]!.close).toBe(63200.56);
    });

    it('rounds non-USDT pair prices to 8 decimals', async () => {
      const request = { ...baseRequest, symbol: 'BINANCE:BTCETH', tvSymbol: 'BINANCE:BTCETH' };
      const klines = [
        createMockKlineRow(FIXED_NOW, '0.0512345678', '0.0523456789', '0.0501234567', '0.0518765432', '10'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => klines,
      });

      const series = await provider().fetchCandles(request);

      expect(series.candles[0]!.open).toBe(0.05123457);
      expect(series.candles[0]!.high).toBe(0.05234568);
      expect(series.candles[0]!.low).toBe(0.05012346);
      expect(series.candles[0]!.close).toBe(0.05187654);
    });

    it('includes fetchedAt timestamp in ISO format', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.source.fetchedAt).toBeDefined();
      expect(() => new Date(series.source.fetchedAt).toISOString()).not.toThrow();
    });

    it('sorts candles by time ascending', async () => {
      const unorderedKlines = [
        createMockKlineRow(FIXED_NOW, '63600', '64000', '63400', '63800', '110'),
        createMockKlineRow(FIXED_NOW - 7200000, '63000', '63500', '62500', '63200', '100'),
        createMockKlineRow(FIXED_NOW - 3600000, '63200', '63800', '63000', '63600', '120'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => unorderedKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles[0]!.time).toBeLessThan(series.candles[1]!.time);
      expect(series.candles[1]!.time).toBeLessThan(series.candles[2]!.time);
    });

    it('respects limit parameter capped at 1000', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const request = { ...baseRequest, limit: 5000 };
      await provider().fetchCandles(request);

      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const calledUrl = String(calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('limit=1000');
    });
  });

  describe('newest candle completeness', () => {
    // A single bar opening at FIXED_NOW; only its close time versus the host
    // clock decides the hint. Fake timers are required because the inference
    // compares against `Date.now()`.
    function klineWithCloseTime(closeTime: number) {
      const row = createMockKlineRow(FIXED_NOW, '63000', '63500', '62500', '63200', '100');
      row[6] = closeTime;
      return [row];
    }

    function mockKlines(rows: ReturnType<typeof createMockKlineRow>[]) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => rows,
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reports forming when the exchange close time is still ahead of our clock', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW); // before the bar closes
      mockKlines(klineWithCloseTime(FIXED_NOW + 3_600_000));

      const series = await provider().fetchCandles(baseRequest);

      expect(series.lastCandleStatus).toBe('forming');
    });

    it('reports unknown — never closed — when the close time already reads in the past', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW + 3_601_000); // past the close time
      mockKlines(klineWithCloseTime(FIXED_NOW + 3_600_000));

      const series = await provider().fetchCandles(baseRequest);

      // Our clock may simply lag the exchange, so a past close time is not
      // evidence that the bar has actually closed.
      expect(series.lastCandleStatus).toBe('unknown');
    });

    it('reports unknown when no usable close time is reported', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_NOW);
      mockKlines(klineWithCloseTime(0));

      const series = await provider().fetchCandles(baseRequest);

      expect(series.lastCandleStatus).toBe('unknown');
    });
  });

  describe('HTTP error responses', () => {
    it('throws MarketDataError with kind upstream on HTTP 429', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError with kind upstream on HTTP 500', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError with kind upstream on HTTP 502', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('includes status code and truncated body in error message', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid symbol',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(/binance responded 400/);
    });
  });

  describe('request timeout and abort behavior', () => {
    it('throws MarketDataError with kind upstream on AbortError', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new DOMException('Aborted', 'AbortError'),
      );

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError with kind upstream on timeout', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'TimeoutError';
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(timeoutError);

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError with kind upstream on network failure', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('fetch failed: connection refused'),
      );

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });
  });

  describe('malformed responses', () => {
    it('throws MarketDataError when response is not valid JSON', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError when payload is not an array', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'invalid' }),
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError when kline rows have malformed numeric values', async () => {
      const badKlines = [
        [FIXED_NOW, 'not-a-number', '63500', '62500', '63200', '100', 0, 0, 0, 0, 0, '0'],
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => badKlines,
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError when kline rows have insufficient elements', async () => {
      const shortKlines = [
        [FIXED_NOW, '63000', '63500'],
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => shortKlines,
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });
  });

  describe('empty responses', () => {
    it('throws MarketDataError when Binance returns empty array', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('throws MarketDataError when all candles are filtered out by sanitizeCandles', async () => {
      const invalidKlines = [
        createMockKlineRow(FIXED_NOW, 'NaN', '63500', '62500', '63200', '100'),
        createMockKlineRow(FIXED_NOW - 3600000, '63000', 'Infinity', '62500', '63200', '100'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => invalidKlines,
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });
  });

  describe('partially corrupt responses', () => {
    it('drops only the malformed rows and keeps the usable candles', async () => {
      const mixedKlines = [
        createMockKlineRow(FIXED_NOW - 7200000, '63000', '63500', '62500', '63200', '100'),
        // low above high — an impossible OHLC relationship.
        createMockKlineRow(FIXED_NOW - 3600000, '63200', '63000', '63800', '63600', '120'),
        // timestamp in seconds instead of epoch milliseconds.
        createMockKlineRow(1_700_000_000, '63200', '63800', '63000', '63600', '120'),
        createMockKlineRow(FIXED_NOW, '63600', '64000', '63400', '63800', '110'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mixedKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles).toHaveLength(2);
      expect(series.candles[0]!.time).toBe(FIXED_NOW - 7200000);
      expect(series.candles[1]!.time).toBe(FIXED_NOW);
    });

    it('collapses duplicate timestamps instead of returning zero-length intervals', async () => {
      const duplicatedKlines = [
        createMockKlineRow(FIXED_NOW - 3600000, '63200', '63800', '63000', '63600', '120'),
        createMockKlineRow(FIXED_NOW - 3600000, '63200', '63900', '63000', '63700', '130'),
        createMockKlineRow(FIXED_NOW, '63600', '64000', '63400', '63800', '110'),
      ];
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => duplicatedKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles).toHaveLength(2);
      const [first, second] = series.candles;
      expect(second!.time - first!.time).toBeGreaterThan(0);
    });
  });

  describe('asset class and symbol validation', () => {
    it('throws MarketDataError with kind unsupported for forex asset class', async () => {
      const request = { ...baseRequest, assetClass: 'forex' as const, symbol: 'FX:EURUSD' };

      await expect(provider().fetchCandles(request)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(request)).rejects.toMatchObject({
        kind: 'unsupported',
      });
    });

    it('throws MarketDataError with kind unsupported for stocks asset class', async () => {
      const request = { ...baseRequest, assetClass: 'stocks' as const, symbol: 'NASDAQ:AAPL' };

      await expect(provider().fetchCandles(request)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(request)).rejects.toMatchObject({
        kind: 'unsupported',
      });
    });

    it('throws MarketDataError with kind invalid_symbol for non-BINANCE prefix', async () => {
      const request = { ...baseRequest, symbol: 'COINBASE:BTCUSDT' };

      await expect(provider().fetchCandles(request)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(request)).rejects.toMatchObject({
        kind: 'invalid_symbol',
      });
    });

    it('throws MarketDataError with kind invalid_symbol for non-BINANCE prefix', async () => {
      const request = { ...baseRequest, symbol: 'KRAKEN:BTCUSDT' };

      await expect(provider().fetchCandles(request)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(request)).rejects.toMatchObject({
        kind: 'invalid_symbol',
      });
    });

    it('accepts lowercase binance prefix (case-insensitive)', async () => {
      const request = { ...baseRequest, symbol: 'binance:BTCUSDT', tvSymbol: 'binance:BTCUSDT' };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const series = await provider().fetchCandles(request);
      expect(series.symbol).toBe('binance:BTCUSDT');
    });

    it('throws MarketDataError with kind invalid_symbol for malformed ticker', async () => {
      const request = { ...baseRequest, symbol: 'BINANCE:@@@' };

      await expect(provider().fetchCandles(request)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(request)).rejects.toMatchObject({
        kind: 'invalid_symbol',
      });
    });

    it('accepts valid BINANCE: symbol without prefix in ticker', async () => {
      const request = { ...baseRequest, symbol: 'BTCUSDT', tvSymbol: 'BTCUSDT' };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const series = await provider().fetchCandles(request);
      expect(series.symbol).toBe('BTCUSDT');
    });
  });

  describe('no silent substitution', () => {
    it('throws on upstream failure rather than fabricating candles', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network down'),
      );

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);

      // The failure must surface as an error, never as a fabricated series.
      try {
        await provider().fetchCandles(baseRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(MarketDataError);
        expect((error as MarketDataError).kind).toBe('upstream');
      }
    });

    it('throws on HTTP 5xx rather than fabricating candles', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);

      try {
        await provider().fetchCandles(baseRequest);
      } catch (error) {
        expect(error).toBeInstanceOf(MarketDataError);
        expect((error as MarketDataError).kind).toBe('upstream');
      }
    });

    it('successful response always has mode live', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const series = await provider().fetchCandles(baseRequest);

      expect(series.source.mode).toBe('live');
      expect(series.source.provider).toBe('binance');
    });
  });

  describe('custom baseUrl', () => {
    it('uses custom baseUrl when provided', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleKlines,
      });

      const customUrl = 'https://testnet.binance.vision';
      await provider(customUrl).fetchCandles(baseRequest);

      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const calledUrl = String(calls[0]?.[0] ?? '');
      expect(calledUrl).toContain(customUrl);
    });
  });

  describe('health check', () => {
    it('returns ok true when ping succeeds', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
      });

      const result = await provider().health();
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('binance.com');
    });

    it('returns ok false when ping fails', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider().health();
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('HTTP 500');
    });

    it('returns ok false on network error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      const result = await provider().health();
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('connection refused');
    });
  });
});