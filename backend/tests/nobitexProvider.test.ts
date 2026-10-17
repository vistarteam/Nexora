import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NobitexMarketDataProvider } from '../src/services/marketData/nobitexProvider.js';
import { MarketDataError } from '../src/services/marketData/types.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const FIXED_NOW_SEC = FIXED_NOW_MS / 1_000;
const BASE_URL = 'https://nobitex.test';

const baseRequest = {
  symbol: 'NOBITEX:BTCIRT',
  tvSymbol: 'BINANCE:BTCUSDT',
  assetClass: 'crypto' as const,
  timeframe: '1h' as const,
  limit: 100,
};

interface Row {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Build a TradingView-UDF reply, the shape Nobitex actually returns. */
function udf(rows: Row[]) {
  return {
    s: 'ok',
    t: rows.map((row) => row.t),
    o: rows.map((row) => row.o),
    h: rows.map((row) => row.h),
    l: rows.map((row) => row.l),
    c: rows.map((row) => row.c),
    v: rows.map((row) => row.v),
  };
}

function hourRow(offsetSeconds: number): Row {
  const t = FIXED_NOW_SEC + offsetSeconds;
  return { t, o: 4_500_000_000, h: 4_510_000_000, l: 4_490_000_000, c: 4_505_000_000, v: 1.5 };
}

const sampleRows = [hourRow(-7_200), hourRow(-3_600), hourRow(0)];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function provider(options: { baseUrl?: string; now?: number } = {}) {
  return new NobitexMarketDataProvider({
    baseUrl: options.baseUrl ?? BASE_URL,
    now: () => options.now ?? FIXED_NOW_MS,
  });
}

/** Answer every request with the same payload (paging then stops on the duplicate). */
function mockEveryResponse(payload: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    ok: true,
    json: async () => payload,
  }));
}

describe('NobitexMarketDataProvider', () => {
  describe('request shape', () => {
    it('requests the UDF history endpoint with the mapped resolution', async () => {
      mockEveryResponse(udf(sampleRows));

      await provider().fetchCandles(baseRequest);

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('/market/udf/history');
      expect(url).toContain('symbol=BTCIRT');
      expect(url).toContain('resolution=60'); // 1h
      expect(url).toContain('countback=100');
      expect(url).toContain(`to=${FIXED_NOW_SEC}`);
    });

    it('maps a daily request onto Nobitex daily resolution', async () => {
      mockEveryResponse(udf(sampleRows));

      await provider().fetchCandles({ ...baseRequest, timeframe: '1d' });

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('resolution=D');
    });

    it('assembles a weekly request from daily bars, which Nobitex does expose', async () => {
      mockEveryResponse(udf(sampleRows));

      await provider().fetchCandles({ ...baseRequest, timeframe: '1w' });

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('resolution=D');
    });

    it('caps the upstream window even when a larger limit is requested', async () => {
      mockEveryResponse(udf(sampleRows));

      await provider().fetchCandles({ ...baseRequest, limit: 5_000 });

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('countback=500');
    });
  });

  describe('response parsing', () => {
    it('parses parallel UDF arrays into candles with millisecond timestamps', async () => {
      mockEveryResponse(udf(sampleRows));

      const series = await provider().fetchCandles(baseRequest);

      expect(series.source.provider).toBe('nobitex');
      expect(series.source.mode).toBe('live');
      expect(series.symbol).toBe('NOBITEX:BTCIRT');
      expect(series.timeframe).toBe('1h');
      expect(series.candles).toHaveLength(3);

      const first = series.candles[0]!;
      expect(first.time).toBe((FIXED_NOW_SEC - 7_200) * 1_000);
      expect(first.close).toBe(4_505_000_000);
      expect(first.volume).toBe(1.5);
    });

    it('rounds Toman-quoted prices to whole numbers', async () => {
      mockEveryResponse(
        udf([
          {
            t: FIXED_NOW_SEC,
            o: 4_499_999_999.6,
            h: 4_510_000_000.4,
            l: 4_489_999_999.2,
            c: 4_505_000_000.5,
            v: 1,
          },
        ]),
      );

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles[0]!.open).toBe(4_500_000_000);
      expect(series.candles[0]!.close).toBe(4_505_000_001);
    });

    it('keeps two decimals for tether-quoted pairs', async () => {
      mockEveryResponse(
        udf([
          { t: FIXED_NOW_SEC, o: 63_000.12345, h: 63_500.98765, l: 62_500.11111, c: 63_200.55555, v: 10 },
        ]),
      );

      const series = await provider().fetchCandles({
        ...baseRequest,
        symbol: 'BINANCE:BTCUSDT',
        tvSymbol: 'BINANCE:BTCUSDT',
      });

      expect(series.candles[0]!.open).toBe(63_000.12);
      expect(series.candles[0]!.close).toBe(63_200.56);
    });

    it('accepts a bare ticker with no exchange prefix', async () => {
      mockEveryResponse(udf(sampleRows));

      const series = await provider().fetchCandles({ ...baseRequest, symbol: 'BTCIRT' });

      expect(series.candles).toHaveLength(3);
      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('symbol=BTCIRT');
    });

    it('sorts candles ascending and collapses duplicate timestamps', async () => {
      mockEveryResponse(
        udf([
          { t: FIXED_NOW_SEC, o: 1, h: 5, l: 1, c: 4, v: 1 },
          { t: FIXED_NOW_SEC - 3_600, o: 4_500_000_000, h: 4_510_000_000, l: 4_490_000_000, c: 4_505_000_000, v: 1 },
          { t: FIXED_NOW_SEC - 3_600, o: 4_500_000_000, h: 4_511_000_000, l: 4_490_000_000, c: 4_506_000_000, v: 1 },
        ]),
      );

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles).toHaveLength(2);
      expect(series.candles[0]!.time).toBeLessThan(series.candles[1]!.time);
    });
  });

  describe('paging', () => {
    it('walks backwards when one reply cannot satisfy the requested window', async () => {
      const pageOne = udf([hourRow(-3_600), hourRow(0)]);
      const pageTwo = udf([hourRow(-10_800), hourRow(-7_200)]);

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => pageOne })
        .mockResolvedValueOnce({ ok: true, json: async () => pageTwo })
        .mockResolvedValueOnce({ ok: true, json: async () => udf([]) });

      const series = await provider().fetchCandles({ ...baseRequest, limit: 60 });

      expect(series.candles).toHaveLength(4);
      const secondUrl = String(fetchMock.mock.calls[1]?.[0] ?? '');
      // The cursor must move strictly before the earliest row already held.
      expect(secondUrl).toContain(`to=${FIXED_NOW_SEC - 3_600 - 1}`);
    });
  });

  describe('weekly aggregation', () => {
    it('folds daily bars into weekly candles aligned to the epoch', async () => {
      const daily = Array.from({ length: 70 }, (_, index) => ({
        t: FIXED_NOW_SEC - index * 86_400,
        o: 4_500_000_000 + index,
        h: 4_600_000_000 + index,
        l: 4_400_000_000,
        c: 4_550_000_000 + index,
        v: 1,
      }));
      // One reply satisfies the whole window, so no further page is requested.
      mockEveryResponse(udf(daily));

      const series = await provider().fetchCandles({ ...baseRequest, timeframe: '1w', limit: 10 });

      expect(series.candles).toHaveLength(10);
      for (let index = 1; index < series.candles.length; index += 1) {
        expect(series.candles[index]!.time - series.candles[index - 1]!.time).toBe(7 * 86_400_000);
      }
      // Each weekly bar spans several daily bars, so its high exceeds any single day's open.
      expect(series.candles[0]!.high).toBeGreaterThan(4_600_000_000);
    });
  });

  describe('newest candle status', () => {
    it('reports forming when the newest bar has not closed yet', async () => {
      // The newest bar opens at FIXED_NOW, so for 1h it closes an hour later.
      mockEveryResponse(udf([hourRow(0)]));

      const series = await provider({ now: FIXED_NOW_MS }).fetchCandles(baseRequest);

      expect(series.lastCandleStatus).toBe('forming');
    });

    it('reports unknown — never closed — once the close time is in the past', async () => {
      mockEveryResponse(udf([hourRow(0)]));

      const series = await provider({ now: FIXED_NOW_MS + 3_601_000 }).fetchCandles(baseRequest);

      expect(series.lastCandleStatus).toBe('unknown');
    });
  });

  describe('symbol and asset-class validation', () => {
    it('rejects a non-crypto asset class as unsupported', async () => {
      await expect(
        provider().fetchCandles({ ...baseRequest, assetClass: 'forex', symbol: 'FX:EURUSD' }),
      ).rejects.toMatchObject({ kind: 'unsupported' });
    });

    it('rejects a foreign exchange prefix', async () => {
      await expect(
        provider().fetchCandles({ ...baseRequest, symbol: 'COINBASE:BTCUSDT' }),
      ).rejects.toMatchObject({ kind: 'invalid_symbol' });
    });

    it('rejects a malformed ticker', async () => {
      await expect(
        provider().fetchCandles({ ...baseRequest, symbol: 'NOBITEX:@@' }),
      ).rejects.toMatchObject({ kind: 'invalid_symbol' });
    });
  });

  describe('failure handling', () => {
    it('maps an HTTP failure to an upstream error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('maps a network failure to an upstream error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused'),
      );

      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('treats an empty window as unavailable rather than returning a series', async () => {
      mockEveryResponse({ s: 'no_data' });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(baseRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('rejects an error status reported inside a 200 response', async () => {
      mockEveryResponse({ s: 'error', errmsg: 'Invalid resolution!' });

      await expect(provider().fetchCandles(baseRequest)).rejects.toThrow(/Invalid resolution/);
    });

    it('drops unusable rows and keeps the rest', async () => {
      mockEveryResponse(
        udf([
          { t: FIXED_NOW_SEC - 3_600, o: 4_500_000_000, h: 4_510_000_000, l: 4_490_000_000, c: 4_505_000_000, v: 1 },
          // low above high is impossible and must be dropped.
          { t: FIXED_NOW_SEC, o: 4_500_000_000, h: 4_500_000_000, l: 4_600_000_000, c: 4_505_000_000, v: 1 },
        ]),
      );

      const series = await provider().fetchCandles(baseRequest);

      expect(series.candles).toHaveLength(1);
    });
  });

  describe('health', () => {
    it('reports ok when the probe pair answers', async () => {
      mockEveryResponse(udf([{ t: FIXED_NOW_SEC, o: 1, h: 1, l: 1, c: 1, v: 0 }]));

      const result = await provider().health();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain(BASE_URL);
    });

    it('probes a USDT-quoted pair, the market the app actually serves', async () => {
      // The UDF endpoint answers 403 for the IRT-quoted pairs but 200 for the
      // USDT ones, so probing an IRT pair would report the provider as down
      // while every request the app makes is fine.
      mockEveryResponse({ s: 'ok' });

      await provider().health();

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('symbol=BTCUSDT');
      expect(url).not.toContain('symbol=BTCIRT');
    });

    it('reports not ok when the endpoint is unreachable', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('getaddrinfo ENOTFOUND'),
      );

      const result = await provider().health();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('ENOTFOUND');
    });
  });
});
