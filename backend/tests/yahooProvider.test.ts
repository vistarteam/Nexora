import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YahooMarketDataProvider } from '../src/services/marketData/yahooProvider.js';
import { MarketDataError } from '../src/services/marketData/types.js';

const FIXED_NOW_MS = 1_700_000_000_000;
const FIXED_NOW_SEC = FIXED_NOW_MS / 1_000;
const BASE_URL = 'https://yahoo.test';

const forexRequest = {
  symbol: 'FX:EURUSD',
  tvSymbol: 'FX:EURUSD',
  assetClass: 'forex' as const,
  timeframe: '1h' as const,
  limit: 100,
};

const stocksRequest = {
  symbol: 'NASDAQ:AAPL',
  tvSymbol: 'NASDAQ:AAPL',
  assetClass: 'stocks' as const,
  timeframe: '1d' as const,
  limit: 100,
};

interface Row {
  t: number;
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

/** Build a Yahoo chart reply (`timestamps` + parallel indicator arrays). */
function chart(rows: Row[]) {
  return {
    chart: {
      result: [
        {
          timestamp: rows.map((row) => row.t),
          indicators: {
            quote: [
              {
                open: rows.map((row) => row.o),
                high: rows.map((row) => row.h),
                low: rows.map((row) => row.l),
                close: rows.map((row) => row.c),
                volume: rows.map((row) => row.v),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function hourRow(offsetSeconds: number, price = 1.09): Row {
  return {
    t: FIXED_NOW_SEC + offsetSeconds,
    o: price,
    h: price + 0.001,
    l: price - 0.001,
    c: price + 0.0005,
    v: 1_000,
  };
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
  return new YahooMarketDataProvider({
    baseUrl: options.baseUrl ?? BASE_URL,
    now: () => options.now ?? FIXED_NOW_MS,
  });
}

function mockEveryResponse(payload: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
    ok: true,
    json: async () => payload,
  }));
}

/**
 * Calendar seconds between `period1` and `period2` on the most recent chart
 * request. Reads the URL the provider actually built, which is the only place
 * the requested history window is observable from a test.
 */
function requestedSpan(nowSeconds: number): number {
  const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
  const match = /period1=(\d+)/.exec(url);
  expect(match).not.toBeNull();
  return nowSeconds - Number(match![1]);
}

describe('YahooMarketDataProvider', () => {
  describe('symbol mapping', () => {
    it('maps a currency pair onto the Yahoo "=X" convention', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles(forexRequest);

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('/v8/finance/chart/EURUSD%3DX');
      expect(url).toContain('interval=60m');
      expect(url).toContain('period1=');
      expect(url).toContain('period2=');
    });

    it('maps spot gold onto the Yahoo futures ticker', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles({ ...forexRequest, symbol: 'FX:XAUUSD' });

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain(`chart/${encodeURIComponent('GC=F')}`);
    });

    it('strips the exchange namespace from an equity symbol', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles(stocksRequest);

      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('/v8/finance/chart/AAPL');
      expect(url).toContain('interval=1d');
    });

    it('rejects a forex symbol that is not a currency pair', async () => {
      await expect(
        provider().fetchCandles({ ...forexRequest, symbol: 'FX:EURO' }),
      ).rejects.toMatchObject({ kind: 'invalid_symbol' });
    });

    it('rejects a malformed equity symbol', async () => {
      await expect(
        provider().fetchCandles({ ...stocksRequest, symbol: 'NASDAQ:1AAPL' }),
      ).rejects.toMatchObject({ kind: 'invalid_symbol' });
    });
  });

  describe('response parsing', () => {
    it('parses the chart payload into candles with millisecond timestamps', async () => {
      mockEveryResponse(chart(sampleRows));

      const series = await provider().fetchCandles(forexRequest);

      expect(series.source.provider).toBe('yahoo');
      expect(series.source.mode).toBe('live');
      expect(series.assetClass).toBe('forex');
      expect(series.candles).toHaveLength(3);

      const first = series.candles[0]!;
      expect(first.time).toBe((FIXED_NOW_SEC - 7_200) * 1_000);
      expect(first.open).toBe(1.09);
      expect(first.volume).toBe(1_000);
    });

    it('preserves sub-cent precision for currency pairs', async () => {
      // A real EURUSD daily bar: the whole range sits below the third decimal, so
      // a 2-decimal rule would flatten it to 1.16/1.16/1.16/1.16.
      mockEveryResponse(
        chart([
          { t: FIXED_NOW_SEC, o: 1.15664434, h: 1.16299355, l: 1.15608274, c: 1.15664434, v: 0 },
        ]),
      );

      const series = await provider().fetchCandles(forexRequest);
      const bar = series.candles[0]!;

      expect(bar.high).toBe(1.163);
      expect(bar.low).toBe(1.1561);
      expect(bar.open).toBe(1.1566);
      expect(bar.high).toBeGreaterThan(bar.low);
    });

    it('rounds an equity price to cents', async () => {
      mockEveryResponse(
        chart([{ t: FIXED_NOW_SEC, o: 342.6399, h: 348.1599, l: 341.1299, c: 342.6799, v: 5 }]),
      );

      const series = await provider().fetchCandles(stocksRequest);

      expect(series.candles[0]!.open).toBe(342.64);
      expect(series.candles[0]!.high).toBe(348.16);
    });

    it('skips bars Yahoo reports with no trade (null OHLC)', async () => {
      mockEveryResponse(
        chart([
          hourRow(-7_200),
          { t: FIXED_NOW_SEC - 3_600, o: null, h: null, l: null, c: null, v: null },
          hourRow(0),
        ]),
      );

      const series = await provider().fetchCandles(forexRequest);

      expect(series.candles).toHaveLength(2);
    });

    it('clamps intraday history to the window Yahoo keeps', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles({ ...forexRequest, timeframe: '5m' });

      const requestedSpanSeconds = requestedSpan(FIXED_NOW_SEC);
      // 60 days is Yahoo's ceiling for 5-minute bars.
      expect(requestedSpanSeconds).toBeLessThanOrEqual(60 * 24 * 60 * 60);
    });
  });

  describe('history window sizing', () => {
    const DAY = 24 * 60 * 60;

    it('asks for ~6x calendar time for equities, so an hourly request clears SMA200', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles({ ...stocksRequest, timeframe: '1h', limit: 300 });

      // A stock trades ~6.5h a day, 5 days a week: 300 hourly bars need roughly
      // 75 calendar days. The previous flat 1.4 factor asked for ~17, which came
      // back as ~87 bars — below the 205 `SMA200` needs, so every intraday equity
      // analysis reported `insufficient_data`.
      expect(requestedSpan(FIXED_NOW_SEC)).toBeGreaterThan(70 * DAY);
    });

    it('no longer caps hourly history at 60 days', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles({ ...stocksRequest, timeframe: '1h', limit: 650 });

      // Yahoo keeps `60m` bars for two years, so the old 60-day ceiling was an
      // artificial limit rather than an upstream one.
      expect(requestedSpan(FIXED_NOW_SEC)).toBeGreaterThan(60 * DAY);
    });

    it('keeps an hourly equity 4h request within Yahoo\'s two-year window', async () => {
      mockEveryResponse(chart(sampleRows));

      await provider().fetchCandles({ ...stocksRequest, timeframe: '4h', limit: 300 });

      const span = requestedSpan(FIXED_NOW_SEC);
      expect(span).toBeGreaterThan(60 * DAY);
      expect(span).toBeLessThanOrEqual(730 * DAY);
    });
  });

  describe('4-hour aggregation', () => {
    it('folds hourly bars into 4-hour candles', async () => {
      const hourly = Array.from({ length: 8 }, (_, index) =>
        hourRow(-7 * 3_600 + index * 3_600, 1.09 + index / 10_000),
      );
      mockEveryResponse(chart(hourly));

      const series = await provider().fetchCandles({
        ...forexRequest,
        timeframe: '4h',
        limit: 10,
      });

      // Buckets are epoch-aligned, so a 7-hour input window can straddle three.
      expect(series.candles).toHaveLength(3);
      for (let index = 1; index < series.candles.length; index += 1) {
        expect(series.candles[index]!.time - series.candles[index - 1]!.time).toBe(4 * 3_600 * 1_000);
      }
      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(url).toContain('interval=60m');
    });
  });

  describe('newest candle status', () => {
    it('reports forming while the newest daily bar is still open', async () => {
      mockEveryResponse(chart([hourRow(0)]));

      const series = await provider({ now: FIXED_NOW_MS }).fetchCandles({
        ...forexRequest,
        timeframe: '1d',
      });

      expect(series.lastCandleStatus).toBe('forming');
    });

    it('reports unknown — never closed — once the bar is in the past', async () => {
      mockEveryResponse(chart([hourRow(0)]));

      const series = await provider({ now: FIXED_NOW_MS + 2 * 86_400_000 }).fetchCandles({
        ...forexRequest,
        timeframe: '1d',
      });

      expect(series.lastCandleStatus).toBe('unknown');
    });
  });

  describe('asset-class validation', () => {
    it('rejects crypto, which has its own provider', async () => {
      await expect(
        provider().fetchCandles({ ...forexRequest, assetClass: 'crypto', symbol: 'BINANCE:BTCUSDT' }),
      ).rejects.toMatchObject({ kind: 'unsupported' });
    });
  });

  describe('failure handling', () => {
    it('maps an HTTP failure to an upstream error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      await expect(provider().fetchCandles(forexRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('maps a network failure to an upstream error', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('fetch failed'),
      );

      await expect(provider().fetchCandles(forexRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('surfaces an error embedded in a 200 response', async () => {
      mockEveryResponse({ chart: { result: null, error: { description: 'No data found' } } });

      await expect(provider().fetchCandles(forexRequest)).rejects.toThrow(/No data found/);
    });

    it('fails explicitly when the chart carries no candles', async () => {
      mockEveryResponse({ chart: { result: [] } });

      await expect(provider().fetchCandles(forexRequest)).rejects.toThrow(MarketDataError);
      await expect(provider().fetchCandles(forexRequest)).rejects.toMatchObject({
        kind: 'upstream',
      });
    });

    it('never fabricates candles for a failed live request', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('blocked'));

      await expect(provider().fetchCandles(forexRequest)).rejects.toBeInstanceOf(MarketDataError);
    });
  });

  describe('health', () => {
    it('reports ok when the probe answers with a result', async () => {
      mockEveryResponse(chart(sampleRows));

      const result = await provider().health();

      expect(result.ok).toBe(true);
      expect(result.detail).toContain(BASE_URL);
    });

    it('reports not ok when the probe has no result', async () => {
      mockEveryResponse({ chart: { result: [] } });

      const result = await provider().health();

      expect(result.ok).toBe(false);
    });

    it('reports not ok when unreachable', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('ETIMEDOUT'),
      );

      const result = await provider().health();

      expect(result.ok).toBe(false);
      expect(result.detail).toContain('ETIMEDOUT');
    });
  });
});
