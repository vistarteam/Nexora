import type { Candle, CandleSeries } from '../../types/domain.js';
import { TIMEFRAME_MS } from './catalog.js';
import { sanitizeCandles, type CandleRequest, type MarketDataProvider } from './types.js';

/**
 * Deterministic demo market-data provider.
 *
 * IMPORTANT: this provider fabricates candles. It exists so the whole stack can
 * be exercised without paid credentials. Every response it produces is stamped
 * `mode: 'demo'`, the API marks the enclosing envelope `demo: true`, and the UI
 * shows a persistent DEMO badge. Demo output must never be presented as real
 * market data.
 *
 * The series is a seeded function of (symbol, timeframe) so the same request
 * returns the same shape, which keeps screenshots and tests stable. Timestamps
 * are anchored to the current clock so the chart looks alive.
 */

/** Reference prices used as the starting point of each demo series. */
const REFERENCE_PRICES: Record<string, number> = {
  'BINANCE:BTCUSDT': 63_400,
  'BINANCE:ETHUSDT': 3_120,
  'BINANCE:SOLUSDT': 148,
  'BINANCE:BNBUSDT': 585,
  'BINANCE:XRPUSDT': 0.62,
  'BINANCE:ADAUSDT': 0.45,
  'BINANCE:DOGEUSDT': 0.155,
  'BINANCE:AVAXUSDT': 34.5,
  'BINANCE:LINKUSDT': 17.2,
  'BINANCE:MATICUSDT': 0.58,
  'BINANCE:TONUSDT': 7.4,
  'BINANCE:TRXUSDT': 0.128,
  'FX:EURUSD': 1.0875,
  'FX:GBPUSD': 1.2715,
  'FX:USDJPY': 156.4,
  'FX:USDCHF': 0.8925,
  'FX:AUDUSD': 0.6645,
  'FX:USDCAD': 1.3625,
  'FX:EURJPY': 170.1,
  'FX:XAUUSD': 2_355,
  'NASDAQ:AAPL': 214.5,
  'NASDAQ:MSFT': 441.2,
  'NASDAQ:NVDA': 122.8,
  'NASDAQ:GOOGL': 178.4,
  'NASDAQ:AMZN': 186.9,
  'NASDAQ:TSLA': 246.3,
  'NASDAQ:META': 498.7,
  'NYSE:JPM': 199.4,
};

/** Per-candle volatility by asset class, expressed as a fraction. */
const BASE_VOLATILITY: Record<string, number> = {
  crypto: 0.009,
  forex: 0.0016,
  stocks: 0.0055,
};

const DECIMALS_BY_CLASS: Record<string, number> = {
  crypto: 2,
  forex: 5,
  stocks: 2,
};

function hashString(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Small, fast, seedable PRNG so demo series are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function referencePrice(symbol: string, fallbackSeed: number): number {
  const known = REFERENCE_PRICES[symbol];
  if (known !== undefined) return known;
  // Unknown symbols still get a stable, plausible-looking magnitude.
  const magnitude = 10 ** (2 + (fallbackSeed % 3));
  return roundTo(magnitude * (0.6 + (fallbackSeed % 100) / 100), 4);
}

export interface DemoProviderOptions {
  /** Override the anchor timestamp (tests use a fixed clock). */
  now?: number;
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = 'demo';
  readonly label = 'تولیدکننده داده دمو';
  readonly mode = 'demo' as const;
  readonly supports = ['crypto', 'forex', 'stocks'] as const;

  constructor(private readonly options: DemoProviderOptions = {}) {}

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    const { symbol, tvSymbol, assetClass, timeframe, limit } = request;
    const intervalMs = TIMEFRAME_MS[timeframe];
    const seed = hashString(`${symbol}|${timeframe}`);
    const random = mulberry32(seed);

    const decimals = DECIMALS_BY_CLASS[assetClass] ?? 2;
    const reference = referencePrice(symbol, seed);
    // Normalise volatility to the candle duration so a 1w series is not as
    // calm as a 1m series.
    const minuteScale = Math.sqrt(Math.max(1, intervalMs / 60_000));
    const volatility = (BASE_VOLATILITY[assetClass] ?? 0.005) * Math.min(minuteScale, 6);

    const now = this.options.now ?? Date.now();
    const lastOpenTime = now - (now % intervalMs);
    const count = Math.max(5, Math.min(limit, 1000));
    const firstOpenTime = lastOpenTime - (count - 1) * intervalMs;

    // A regime drives a slow drift so trend analysis has a real structure to
    // find instead of pure noise. Kept deliberately weak and short-lived so the
    // demo series stays inside a believable band around its reference price
    // rather than wandering to implausible levels over a long window.
    const regimeLength = Math.max(16, Math.round(count / 8));
    let drift = 0;
    let driftTarget = (random() - 0.5) * volatility * 0.35;

    const closes: number[] = [];
    let price = reference * (1 - volatility * 4 * (random() - 0.5));

    for (let index = 0; index < count; index += 1) {
      if (index % regimeLength === 0) {
        // New regime: pick a fresh directional bias.
        driftTarget = (random() - 0.5) * volatility * 0.35;
      }
      drift += (driftTarget - drift) * 0.08;
      const shock = (random() + random() + random() - 1.5) * volatility;
      price *= 1 + drift + shock;
      // Keep the walk in a sane band around the reference price.
      price = Math.min(reference * 1.6, Math.max(reference * 0.62, price));
      closes.push(price);
    }

    const candles: Candle[] = [];
    let previousClose = closes[0] ?? reference;

    for (let index = 0; index < count; index += 1) {
      const close = closes[index] ?? previousClose;
      // Each candle opens where the previous one closed (no gaps).
      const open = previousClose;
      const bodyHigh = Math.max(open, close);
      const bodyLow = Math.min(open, close);
      const wickUp = bodyHigh * volatility * (0.15 + random() * 0.55);
      const wickDown = bodyLow * volatility * (0.15 + random() * 0.55);
      const volumeBase = assetClass === 'forex' ? 120_000 : 4_000;
      const volume = roundTo(
        volumeBase * (0.4 + random() * 1.6) * (1 + Math.abs(close - open) / Math.max(open, 1e-9) * 30),
        2,
      );

      candles.push({
        time: firstOpenTime + index * intervalMs,
        open: roundTo(open, decimals),
        high: roundTo(bodyHigh + wickUp, decimals),
        low: roundTo(Math.max(bodyLow - wickDown, bodyLow * 0.5), decimals),
        close: roundTo(close, decimals),
        volume,
      });
      previousClose = close;
    }

    return {
      symbol,
      tvSymbol,
      assetClass,
      timeframe,
      candles: sanitizeCandles(candles),
      source: {
        provider: this.id,
        mode: 'demo',
        fetchedAt: new Date(now).toISOString(),
      },
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'deterministic synthetic candles (not real market data)' };
  }
}
