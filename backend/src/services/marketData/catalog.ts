import type { AssetClass, MarketSymbol, Timeframe } from '../../types/domain.js';

/**
 * Static instrument catalog.
 *
 * A curated list keeps symbol selection predictable and avoids depending on an
 * exchange's symbol-discovery endpoint being reachable. A dynamic catalog can
 * implement the same shape later.
 */
export const MARKET_CATALOG: readonly MarketSymbol[] = [
  // ---------------- Cryptocurrency ----------------
  { symbol: 'BINANCE:BTCUSDT', tvSymbol: 'BINANCE:BTCUSDT', name: 'بیت‌کوین / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:ETHUSDT', tvSymbol: 'BINANCE:ETHUSDT', name: 'اتریوم / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:SOLUSDT', tvSymbol: 'BINANCE:SOLUSDT', name: 'سولانا / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:BNBUSDT', tvSymbol: 'BINANCE:BNBUSDT', name: 'بایننس‌کوین / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:XRPUSDT', tvSymbol: 'BINANCE:XRPUSDT', name: 'ریپل / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:ADAUSDT', tvSymbol: 'BINANCE:ADAUSDT', name: 'کاردانو / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:DOGEUSDT', tvSymbol: 'BINANCE:DOGEUSDT', name: 'دوج‌کوین / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:AVAXUSDT', tvSymbol: 'BINANCE:AVAXUSDT', name: 'آوالانچ / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:LINKUSDT', tvSymbol: 'BINANCE:LINKUSDT', name: 'چین‌لینک / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:MATICUSDT', tvSymbol: 'BINANCE:MATICUSDT', name: 'پالیگان / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:TONUSDT', tvSymbol: 'BINANCE:TONUSDT', name: 'تون‌کوین / تتر', assetClass: 'crypto', venue: 'Binance' },
  { symbol: 'BINANCE:TRXUSDT', tvSymbol: 'BINANCE:TRXUSDT', name: 'ترون / تتر', assetClass: 'crypto', venue: 'Binance' },

  // ---------------- Forex ----------------
  { symbol: 'FX:EURUSD', tvSymbol: 'FX:EURUSD', name: 'یورو / دلار آمریکا', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:GBPUSD', tvSymbol: 'FX:GBPUSD', name: 'پوند / دلار آمریکا', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:USDJPY', tvSymbol: 'FX:USDJPY', name: 'دلار آمریکا / ین ژاپن', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:USDCHF', tvSymbol: 'FX:USDCHF', name: 'دلار آمریکا / فرانک سوئیس', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:AUDUSD', tvSymbol: 'FX:AUDUSD', name: 'دلار استرالیا / دلار آمریکا', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:USDCAD', tvSymbol: 'FX:USDCAD', name: 'دلار آمریکا / دلار کانادا', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:EURJPY', tvSymbol: 'FX:EURJPY', name: 'یورو / ین ژاپن', assetClass: 'forex', venue: 'Forex' },
  { symbol: 'FX:XAUUSD', tvSymbol: 'OANDA:XAUUSD', name: 'طلا / دلار آمریکا', assetClass: 'forex', venue: 'Forex' },

  // ---------------- Stocks ----------------
  { symbol: 'NASDAQ:AAPL', tvSymbol: 'NASDAQ:AAPL', name: 'اپل', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:MSFT', tvSymbol: 'NASDAQ:MSFT', name: 'مایکروسافت', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:NVDA', tvSymbol: 'NASDAQ:NVDA', name: 'انویدیا', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:GOOGL', tvSymbol: 'NASDAQ:GOOGL', name: 'آلفابت', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:AMZN', tvSymbol: 'NASDAQ:AMZN', name: 'آمازون', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:TSLA', tvSymbol: 'NASDAQ:TSLA', name: 'تسلا', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NASDAQ:META', tvSymbol: 'NASDAQ:META', name: 'متا', assetClass: 'stocks', venue: 'NASDAQ' },
  { symbol: 'NYSE:JPM', tvSymbol: 'NYSE:JPM', name: 'جی‌پی مورگان چیس', assetClass: 'stocks', venue: 'NYSE' },
];

const CATALOG_BY_SYMBOL = new Map(MARKET_CATALOG.map((item) => [item.symbol.toUpperCase(), item]));

export function findSymbol(symbol: string): MarketSymbol | null {
  return CATALOG_BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/**
 * Resolve a symbol, falling back to a synthetic catalog entry.
 *
 * The fallback keeps the API usable with symbols outside the curated list
 * while still being explicit that the name is derived from the ticker itself.
 */
export function resolveSymbol(symbol: string, assetClass: AssetClass): MarketSymbol {
  const known = findSymbol(symbol);
  if (known) return known;

  const trimmed = symbol.trim().toUpperCase();
  return {
    symbol: trimmed,
    tvSymbol: trimmed,
    name: trimmed.split(':').pop() ?? trimmed,
    assetClass,
    venue: trimmed.includes(':') ? (trimmed.split(':')[0] ?? 'Unknown') : 'Unknown',
  };
}

export function listMarkets(filter?: { assetClass?: AssetClass; query?: string }): MarketSymbol[] {
  let items = [...MARKET_CATALOG];

  if (filter?.assetClass) {
    items = items.filter((item) => item.assetClass === filter.assetClass);
  }

  const query = filter?.query?.trim().toLowerCase();
  if (query) {
    items = items.filter((item) =>
      [item.symbol, item.tvSymbol, item.name, item.venue]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }

  return items;
}

/** Milliseconds covered by each timeframe. 1w uses 7 days. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};
