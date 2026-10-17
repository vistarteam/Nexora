import { describe, expect, it } from 'vitest';
import {
  MARKET_CATALOG,
  TIMEFRAME_MS,
  findSymbol,
  listMarkets,
  resolveSymbol,
} from '../src/services/marketData/catalog.js';
import { NobitexMarketDataProvider } from '../src/services/marketData/nobitexProvider.js';
import { YahooMarketDataProvider } from '../src/services/marketData/yahooProvider.js';
import type { AssetClass } from '../src/types/domain.js';

/**
 * Catalog invariants.
 *
 * The catalog is what the UI offers, so a listing that its routed provider cannot
 * actually serve is worse than a missing one: the user picks it, waits, and gets
 * an upstream error. These checks are offline and cheap, and they pin down the
 * two classes of defect that were observed against the live providers.
 */

const ASSET_CLASSES: readonly AssetClass[] = ['crypto', 'forex', 'stocks'];

/**
 * Tickers the Iranian venue answers with `400 InvalidSymbol` (verified directly
 * against `apiv2.nobitex.ir/market/udf/history`). POL replaced MATIC, and the
 * venue does not list TON or SHIB at all, so none of them may appear here.
 */
const REJECTED_BY_NOBITEX = ['MATICUSDT', 'TONUSDT', 'SHIBUSDT'];

describe('market catalog', () => {
  it('lists unique symbols, each belonging to a real asset class', () => {
    const symbols = MARKET_CATALOG.map((item) => item.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    for (const item of MARKET_CATALOG) {
      expect(ASSET_CLASSES).toContain(item.assetClass);
    }
  });

  it('covers all three asset classes the UI offers', () => {
    for (const assetClass of ASSET_CLASSES) {
      expect(listMarkets({ assetClass }).length).toBeGreaterThan(0);
    }
  });

  it('quotes crypto in USDT — the pairs the Iranian venue serves', () => {
    for (const item of MARKET_CATALOG.filter((entry) => entry.assetClass === 'crypto')) {
      // `BINANCE:XXXUSDT` is the canonical id; the venue provider accepts the
      // ticker half and requires it to be a USDT-quoted pair.
      expect(item.symbol).toMatch(/^BINANCE:[A-Z0-9]{2,18}USDT$/);
    }
  });

  it('never lists a ticker the venue rejects', () => {
    for (const item of MARKET_CATALOG) {
      const ticker = item.symbol.split(':')[1] ?? item.symbol;
      expect(REJECTED_BY_NOBITEX).not.toContain(ticker);
    }
  });

  it('routes every listing to a provider that advertises its asset class', () => {
    const routes: Record<AssetClass, { supports: readonly AssetClass[]; mode: string }> = {
      crypto: new NobitexMarketDataProvider(),
      forex: new YahooMarketDataProvider(),
      stocks: new YahooMarketDataProvider(),
    };
    for (const assetClass of ASSET_CLASSES) {
      expect(routes[assetClass].supports).toContain(assetClass);
      expect(routes[assetClass].mode).toBe('live');
    }
  });

  it('resolves a catalog symbol to its own entry, preserving the display name', () => {
    for (const item of MARKET_CATALOG) {
      expect(findSymbol(item.symbol)).toEqual(item);
      expect(resolveSymbol(item.symbol.toLowerCase(), item.assetClass)).toEqual(item);
    }
  });

  it('derives a display name from an off-catalog symbol instead of inventing one', () => {
    const resolved = resolveSymbol('BINANCE:UNKNOWNPAIR', 'crypto');
    expect(resolved.symbol).toBe('BINANCE:UNKNOWNPAIR');
    expect(resolved.name).toBe('UNKNOWNPAIR');
  });

  it('defines a positive duration for every timeframe', () => {
    for (const value of Object.values(TIMEFRAME_MS)) {
      expect(value).toBeGreaterThan(0);
    }
    expect(TIMEFRAME_MS['1w']).toBe(7 * TIMEFRAME_MS['1d']);
  });
});
