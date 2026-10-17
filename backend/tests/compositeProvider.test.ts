import { describe, expect, it, vi } from 'vitest';
import { CompositeMarketDataProvider } from '../src/services/marketData/compositeProvider.js';
import {
  MarketDataError,
  type CandleRequest,
  type MarketDataProvider,
} from '../src/services/marketData/types.js';
import type { AssetClass, CandleSeries, DataMode } from '../src/types/domain.js';

const FIXED_NOW = 1_700_000_000_000;

function seriesFor(request: CandleRequest, providerId: string): CandleSeries {
  return {
    symbol: request.symbol,
    tvSymbol: request.tvSymbol,
    assetClass: request.assetClass,
    timeframe: request.timeframe,
    candles: [
      { time: FIXED_NOW, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ],
    source: { provider: providerId, mode: 'live', fetchedAt: new Date(FIXED_NOW).toISOString() },
  };
}

/** Minimal in-memory provider standing in for a real upstream. */
function stubProvider(options: {
  id: string;
  supports: AssetClass[];
  mode?: DataMode;
  healthy?: boolean;
  healthDetail?: string;
  fail?: boolean;
}): MarketDataProvider & { fetchCandles: ReturnType<typeof vi.fn> } {
  const fetchCandles = vi.fn(async (request: CandleRequest) => {
    if (options.fail) throw new MarketDataError(`${options.id} is down`, 'upstream');
    return seriesFor(request, options.id);
  });

  return {
    id: options.id,
    label: options.id,
    mode: options.mode ?? 'live',
    supports: options.supports,
    fetchCandles,
    async health() {
      return options.healthy === false
        ? { ok: false, detail: options.healthDetail ?? 'down' }
        : { ok: true, detail: 'ok' };
    },
  } as unknown as MarketDataProvider & { fetchCandles: ReturnType<typeof vi.fn> };
}

const cryptoRequest: CandleRequest = {
  symbol: 'NOBITEX:BTCIRT',
  tvSymbol: 'BINANCE:BTCUSDT',
  assetClass: 'crypto',
  timeframe: '1h',
  limit: 100,
};

function build(overrides: { nobitexHealthy?: boolean; yahooHealthy?: boolean; nobitexDown?: boolean } = {}) {
  const nobitex = stubProvider({
    id: 'nobitex',
    supports: ['crypto'],
    healthy: overrides.nobitexHealthy,
    fail: overrides.nobitexDown,
  });
  const yahoo = stubProvider({ id: 'yahoo', supports: ['forex', 'stocks'], healthy: overrides.yahooHealthy });
  const provider = new CompositeMarketDataProvider([
    { assetClass: 'crypto', provider: nobitex },
    { assetClass: 'forex', provider: yahoo },
    { assetClass: 'stocks', provider: yahoo },
  ]);
  return { provider, nobitex, yahoo };
}

describe('CompositeMarketDataProvider', () => {
  it('routes each asset class to its own provider', async () => {
    const { provider, nobitex, yahoo } = build();

    await provider.fetchCandles(cryptoRequest);
    await provider.fetchCandles({ ...cryptoRequest, assetClass: 'forex', symbol: 'FX:EURUSD' });
    await provider.fetchCandles({ ...cryptoRequest, assetClass: 'stocks', symbol: 'NASDAQ:AAPL' });

    expect(nobitex.fetchCandles).toHaveBeenCalledTimes(1);
    expect(yahoo.fetchCandles).toHaveBeenCalledTimes(2);
  });

  it('reports the venue that actually answered', async () => {
    const { provider } = build();

    const series = await provider.fetchCandles(cryptoRequest);

    expect(series.source.provider).toBe('nobitex');
  });

  it('advertises exactly the asset classes with a live source', () => {
    const { provider } = build();

    expect(provider.mode).toBe('live');
    expect([...provider.supports].sort()).toEqual(['crypto', 'forex', 'stocks']);
  });

  it('does not advertise an asset class whose only source serves no data', () => {
    const empty = stubProvider({ id: 'none', supports: ['crypto'], mode: 'none' });
    const provider = new CompositeMarketDataProvider([{ assetClass: 'crypto', provider: empty }]);

    expect(provider.supports).toEqual([]);
    expect(provider.mode).toBe('none');
  });

  it('fails explicitly for an asset class no route serves', async () => {
    const provider = new CompositeMarketDataProvider([]);

    await expect(provider.fetchCandles(cryptoRequest)).rejects.toMatchObject({
      kind: 'unsupported',
    });
  });

  it('propagates an upstream failure instead of silently falling back', async () => {
    const { provider } = build({ nobitexDown: true });

    await expect(provider.fetchCandles(cryptoRequest)).rejects.toBeInstanceOf(MarketDataError);
  });

  it('is healthy only when every route is healthy', async () => {
    const all = build();
    expect((await all.provider.health()).ok).toBe(true);

    const partlyDown = build({ yahooHealthy: false });
    const result = await partlyDown.provider.health();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('yahoo');
  });
});
