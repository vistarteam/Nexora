import { describe, expect, it } from 'vitest';
import { DemoMarketDataProvider } from '../src/services/marketData/demoProvider.js';

const FIXED_NOW = 1_700_000_000_000;

function provider() {
  return new DemoMarketDataProvider({ now: FIXED_NOW });
}

const baseRequest = {
  symbol: 'BINANCE:BTCUSDT',
  tvSymbol: 'BINANCE:BTCUSDT',
  assetClass: 'crypto' as const,
  timeframe: '1h' as const,
  limit: 120,
};

describe('DemoMarketDataProvider', () => {
  it('always labels its output as demo data', async () => {
    const series = await provider().fetchCandles(baseRequest);
    expect(series.source.mode).toBe('demo');
    expect(series.source.provider).toBe('demo');
  });

  it('is deterministic for the same symbol, timeframe and clock', async () => {
    const first = await provider().fetchCandles(baseRequest);
    const second = await provider().fetchCandles(baseRequest);
    expect(second.candles).toEqual(first.candles);
  });

  it('produces a different series for a different symbol', async () => {
    const btc = await provider().fetchCandles(baseRequest);
    const eth = await provider().fetchCandles({ ...baseRequest, symbol: 'BINANCE:ETHUSDT' });
    expect(eth.candles).not.toEqual(btc.candles);
  });

  it('returns the requested number of candles', async () => {
    const series = await provider().fetchCandles(baseRequest);
    expect(series.candles).toHaveLength(120);
  });

  it('returns candles in ascending time order with a constant interval', async () => {
    const series = await provider().fetchCandles(baseRequest);
    for (let index = 1; index < series.candles.length; index += 1) {
      const previous = series.candles[index - 1]!;
      const current = series.candles[index]!;
      expect(current.time - previous.time).toBe(3_600_000);
    }
  });

  it('produces internally consistent OHLC values', async () => {
    const series = await provider().fetchCandles(baseRequest);
    for (const candle of series.candles) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
      expect(candle.high).toBeGreaterThanOrEqual(candle.open);
      expect(candle.high).toBeGreaterThanOrEqual(candle.close);
      expect(candle.low).toBeLessThanOrEqual(candle.open);
      expect(candle.low).toBeLessThanOrEqual(candle.close);
      expect(candle.close).toBeGreaterThan(0);
    }
  });

  it('serves every supported asset class', async () => {
    for (const assetClass of ['crypto', 'forex', 'stocks'] as const) {
      const series = await provider().fetchCandles({
        ...baseRequest,
        assetClass,
        symbol: assetClass === 'forex' ? 'FX:EURUSD' : 'NASDAQ:AAPL',
      });
      expect(series.assetClass).toBe(assetClass);
      expect(series.candles.length).toBeGreaterThan(0);
    }
  });

  it('clamps an absurd limit instead of allocating unbounded memory', async () => {
    const series = await provider().fetchCandles({ ...baseRequest, limit: 100_000 });
    expect(series.candles.length).toBeLessThanOrEqual(1_000);
  });
});
