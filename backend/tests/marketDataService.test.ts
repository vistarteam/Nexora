import { describe, expect, it } from 'vitest';
import { MarketDataService } from '../src/services/marketData/index.js';
import type {
  CandleRequest,
  MarketDataProvider,
  TickerStreamHandlers,
} from '../src/services/marketData/types.js';
import type { Candle, CandleSeries, DataMode } from '../src/types/domain.js';

/**
 * A provider that records the request it was handed and answers with one valid
 * candle. Enough to assert *routing* without any network or indicator work.
 */
class RecordingProvider implements MarketDataProvider {
  readonly id = 'recording';
  readonly label = 'recording provider';
  readonly mode: DataMode = 'live';
  readonly supports = ['crypto', 'forex', 'stocks'] as const;
  readonly requests: CandleRequest[] = [];

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    this.requests.push(request);
    const candle: Candle = {
      time: 1_700_000_000_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    };
    return {
      symbol: request.symbol,
      tvSymbol: request.tvSymbol,
      assetClass: request.assetClass,
      timeframe: request.timeframe,
      candles: [candle],
      source: { provider: this.id, mode: 'live', fetchedAt: new Date(0).toISOString() },
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}

/**
 * A provider whose candles and pushed ticks a test can script.
 *
 * `fetchCandles` answers with one candle at a fixed time, so the service's REST
 * seed is deterministic; `subscribeTicker` hands back the live handlers so the
 * test can push a trade exactly when it wants.
 */
class StreamingProvider implements MarketDataProvider {
  readonly id = 'streaming';
  readonly label = 'streaming provider';
  readonly mode: DataMode = 'live';
  readonly supports = ['crypto'] as const;
  seedCandle: Candle = {
    time: 1_700_000_000_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
  };
  handlers: TickerStreamHandlers | null = null;
  fetchCount = 0;

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    this.fetchCount += 1;
    return {
      symbol: request.symbol,
      tvSymbol: request.tvSymbol,
      assetClass: request.assetClass,
      timeframe: request.timeframe,
      candles: [this.seedCandle],
      source: { provider: this.id, mode: 'live', fetchedAt: new Date(0).toISOString() },
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  subscribeTicker(
    request: Omit<CandleRequest, 'limit'>,
    handlers: TickerStreamHandlers,
  ): () => void {
    this.handlers = handlers;
    handlers.onStatus('connected');
    void request;
    return () => {
      this.handlers = null;
    };
  }
}

function lastRequest(provider: RecordingProvider): CandleRequest {
  const request = provider.requests.at(-1);
  if (!request) throw new Error('provider was never called');
  return request;
}

describe('MarketDataService', () => {
  it("routes a listed symbol by the catalog's asset class, not the caller's", async () => {
    const provider = new RecordingProvider();

    // Gold is catalogued as forex. A stale URL or a mis-set default that claims
    // `crypto` must not send it to the crypto venue.
    const series = await new MarketDataService(provider).fetchCandles({
      symbol: 'FX:XAUUSD',
      assetClass: 'crypto',
      timeframe: '1h',
      limit: 50,
    });

    expect(lastRequest(provider).assetClass).toBe('forex');
    expect(series.assetClass).toBe('forex');
  });

  it('corrects the class in both directions', async () => {
    const provider = new RecordingProvider();

    await new MarketDataService(provider).fetchCandles({
      symbol: 'BINANCE:BTCUSDT',
      assetClass: 'stocks',
      timeframe: '1d',
      limit: 50,
    });

    expect(lastRequest(provider).assetClass).toBe('crypto');
  });

  it("keeps the caller's class for a symbol outside the catalog", async () => {
    const provider = new RecordingProvider();

    // Nothing in the catalog says what ZZZZ is, so the caller's claim is the
    // only information available and is passed through unchanged.
    await new MarketDataService(provider).fetchCandles({
      symbol: 'NASDAQ:ZZZZ',
      assetClass: 'stocks',
      timeframe: '1h',
      limit: 50,
    });

    expect(lastRequest(provider).assetClass).toBe('stocks');
  });

  it('resolves a lowercase symbol to its canonical catalog form', async () => {
    const provider = new RecordingProvider();

    await new MarketDataService(provider).fetchCandles({
      symbol: 'binance:ethusdt',
      assetClass: 'crypto',
      timeframe: '1h',
      limit: 50,
    });

    expect(lastRequest(provider).symbol).toBe('BINANCE:ETHUSDT');
  });

  it('forwards the caller limit untouched', async () => {
    const provider = new RecordingProvider();

    await new MarketDataService(provider).fetchCandles({
      symbol: 'BINANCE:BTCUSDT',
      assetClass: 'crypto',
      timeframe: '4h',
      limit: 137,
    });

    expect(lastRequest(provider).limit).toBe(137);
  });

  describe('live ticker', () => {
    const HOUR_MS = 3_600_000;

    it('seeds from REST, then serves a pushed tick as a websocket snapshot', async () => {
      const provider = new StreamingProvider();
      const service = new MarketDataService(provider);
      const request = { symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto' as const, timeframe: '1h' as const };

      const seeded = await service.ticker(request);
      expect(seeded.freshness.transport).toBe('rest-polling');
      expect(seeded.price).toBe(100.5);

      const now = Date.now();
      provider.handlers?.onTick({
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '1h',
        candle: null,
        price: 110,
        priceDefinition: 'last_trade',
        eventTime: now,
        tradeVolume: 0.5,
        receivedAt: now,
        streamId: 'nobitex:public:trades-BTCIRT',
        venue: 'nobitex',
      });

      const live = await service.ticker(request);
      expect(live.freshness.transport).toBe('websocket');
      expect(live.freshness.priceDefinition).toBe('last_trade');
      expect(live.price).toBe(110);
      expect(live.dataSource).toBe('nobitex');
      // The seed bar is still the forming bar, so its OHLC absorbs the trade.
      expect(live.candle?.close).toBe(110);
      expect(live.candle?.high).toBe(110);
      // The seed is reused rather than re-fetched on every tick.
      expect(provider.fetchCount).toBe(1);

      service.dispose();
    });

    it('rolls a trade-only feed onto the current period instead of folding into a closed bar', async () => {
      const provider = new StreamingProvider();
      const service = new MarketDataService(provider);
      const hourlyBoundary = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
      // A seed bar that closed two periods ago: exactly what REST returns when
      // the market was quiet, or when a candle frame never arrived.
      provider.seedCandle = {
        time: hourlyBoundary - 2 * HOUR_MS,
        open: 100,
        high: 105,
        low: 95,
        close: 101,
        volume: 10,
      };

      const request = { symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto' as const, timeframe: '1h' as const };
      await service.ticker(request);

      const now = Date.now();
      provider.handlers?.onTick({
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '1h',
        candle: null,
        price: 123,
        priceDefinition: 'last_trade',
        eventTime: now,
        tradeVolume: 0.25,
        receivedAt: now,
        streamId: 'nobitex:public:trades-BTCIRT',
        venue: 'nobitex',
      });

      const live = await service.ticker(request);
      expect(live.price).toBe(123);
      // The chart must never be told that a two-hour-old bar is the forming one.
      expect(live.candleOpenTime).toBe(hourlyBoundary);
      expect(live.candle?.open).toBe(123);
      expect(live.candle?.volume).toBe(0.25);
      expect(live.secondsToClose).toBeGreaterThan(0);
      expect(live.candleCloseTime).toBe(hourlyBoundary + HOUR_MS);

      service.dispose();
    });
  });
});
