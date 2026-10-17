import { describe, expect, it } from 'vitest';
import { MarketDataService } from '../src/services/marketData/index.js';
import type { CandleRequest, MarketDataProvider } from '../src/services/marketData/types.js';
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
});
