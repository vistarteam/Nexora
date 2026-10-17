import { config } from '../../config/env.js';
import type {
  AssetClass,
  Candle,
  CandleSeries,
  LastCandleStatus,
  Timeframe,
} from '../../types/domain.js';
import { createLogger } from '../../lib/logger.js';
import { TIMEFRAME_MS } from './catalog.js';
import {
  assertSupports,
  MarketDataError,
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
} from './types.js';

const log = createLogger('market-data:yahoo');

/**
 * Real forex and stock candles from Yahoo Finance's public chart endpoint
 * (`/v8/finance/chart/{symbol}`).
 *
 * Why this source: it is keyless and, unlike Binance's public REST API, is not
 * blocked from Iranian networks, so NEXORA can serve the forex and equities
 * asset classes for users inside Iran. It is an undocumented endpoint, so the
 * provider treats every response defensively — the schema is validated, never
 * trusted, and a shape change surfaces as an explicit upstream error instead of
 * silently producing empty or wrong candles.
 *
 * Only forex and equities are served; crypto comes from an exchange provider.
 */

/** NEXORA timeframe → Yahoo Finance interval code. */
const YAHOO_INTERVALS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '60m',
  // Yahoo has no 4-hour interval; four hourly bars are folded into one.
  '4h': '60m',
  '1d': '1d',
  '1w': '1wk',
};

/** Native bars per output bar, for timeframes Yahoo cannot return directly. */
const NATIVE_FACTOR: Partial<Record<Timeframe, number>> = { '4h': 4 };

/** Milliseconds covered by each Yahoo interval code we request. */
const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '60m': 3_600_000,
  '1d': 86_400_000,
  '1wk': 604_800_000,
};

/**
 * Yahoo only keeps intraday history for a limited window; asking for more is an
 * error. Clamping keeps the request valid and simply returns fewer bars.
 *
 * The limits differ per interval: minute bars live for a week, 5/15-minute bars
 * for ~60 days, and **hourly** bars for two years. The last one matters — Yahoo
 * verifiably returns thousands of `60m` points across a 700-day window, so
 * clamping hourly history to 60 days (as this used to) starved every intraday
 * equity request. See {@link CALENDAR_COVERAGE}.
 */
const MAX_LOOKBACK_MS: Record<string, number> = {
  '1m': 7 * 24 * 60 * 60 * 1_000,
  '5m': 60 * 24 * 60 * 60 * 1_000,
  '15m': 60 * 24 * 60 * 60 * 1_000,
  '60m': 730 * 24 * 60 * 60 * 1_000,
};

/**
 * How much *calendar* time one requested bar occupies, per asset class.
 *
 * Yahoo returns a bar only when the instrument actually traded, so the nominal
 * span (`count * interval`) is not the span to ask for:
 *
 *   - a 24/7 market (crypto) needs barely more than its nominal span,
 *   - forex trades 24 hours but only five days a week,
 *   - an equity trades ~6.5 hours a day, five days a week, so it needs roughly
 *     `24 / 6.5 * 7 / 5 ≈ 5.2` times the nominal span, plus a margin for
 *     holidays.
 *
 * Getting this wrong is silent and corrosive: with the old flat 1.4 factor a
 * 300-bar hourly equity request came back with ~87 bars — fewer than the 205
 * `SMA200` needs — so every intraday stock analysis reported
 * `insufficient_data` while the daily analysis of the same symbol looked fine.
 */
const CALENDAR_COVERAGE: Record<AssetClass, number> = {
  crypto: 1.4,
  forex: 1.5,
  stocks: 6.0,
};

/** Yahoo tickers that cannot be expressed as `{TICKER}=X`. */
const SYMBOL_OVERRIDES: Record<string, string> = {
  XAUUSD: 'GC=F',
  XAGUSD: 'SI=F',
};

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: unknown[];
      indicators?: { quote?: Array<Record<string, unknown[] | undefined>> };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

export interface YahooProviderOptions {
  /** Override the API origin (tests point this at a stub). */
  baseUrl?: string;
  now?: () => number;
}

export class YahooMarketDataProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  readonly label = 'Yahoo Finance (فارکس و سهام)';
  readonly mode = 'live' as const;
  readonly supports = ['forex', 'stocks'] as const;

  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(options: YahooProviderOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      config.marketData.yahooBaseUrl ||
      'https://query1.finance.yahoo.com'
    ).replace(/\/+$/, '');
    this.now = options.now ?? (() => Date.now());
  }

  private toYahooSymbol(symbol: string, assetClass: AssetClass): string {
    const hasPrefix = symbol.includes(':');
    const prefix = hasPrefix ? (symbol.split(':', 2)[0] ?? '').toUpperCase() : '';
    const ticker = (
      hasPrefix ? (symbol.split(':', 2)[1] ?? '') : symbol
    ).toUpperCase();

    if (assetClass === 'forex') {
      const override = SYMBOL_OVERRIDES[ticker];
      if (override) return override;
      if (/^[A-Z]{6}$/.test(ticker)) return `${ticker}=X`;
      throw new MarketDataError(`unsupported forex symbol "${symbol}"`, 'invalid_symbol');
    }

    if (assetClass === 'stocks') {
      // Any exchange namespace is accepted; Yahoo only needs the ticker.
      if (prefix && !/^[A-Z0-9.\-]{1,16}$/.test(prefix)) {
        throw new MarketDataError(`invalid exchange prefix in "${symbol}"`, 'invalid_symbol');
      }
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
        throw new MarketDataError(`invalid equity symbol "${symbol}"`, 'invalid_symbol');
      }
      return ticker;
    }

    throw new MarketDataError(
      `provider "yahoo" does not serve asset class "${assetClass}"`,
      'unsupported',
    );
  }

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    assertSupports(this, request.assetClass, request.symbol);

    const symbol = this.toYahooSymbol(request.symbol, request.assetClass);
    const interval = YAHOO_INTERVALS[request.timeframe];
    const factor = NATIVE_FACTOR[request.timeframe] ?? 1;
    const limit = Math.max(10, Math.min(request.limit, 1_000, config.marketData.maxLimit));
    const nativeIntervalMs = INTERVAL_MS[interval] ?? 86_400_000;
    const nativeCount = limit * factor;

    const now = this.now();
    const period2 = Math.floor(now / 1_000);
    const coverage = CALENDAR_COVERAGE[request.assetClass] ?? 1.4;
    const desiredSpan = Math.round(nativeCount * nativeIntervalMs * coverage + nativeIntervalMs);
    const maxSpan = MAX_LOOKBACK_MS[interval];
    const span = maxSpan === undefined ? desiredSpan : Math.min(desiredSpan, maxSpan);
    const period1 = Math.floor((now - span) / 1_000);

    const payload = await this.requestChart(symbol, interval, period1, period2);
    const native = yahooToCandles(payload);
    if (native.length === 0) {
      throw new MarketDataError(
        `yahoo returned no usable candles for ${symbol} (${interval})`,
        'upstream',
      );
    }

    const cleanNative = sanitizeCandles(native);
    if (cleanNative.length === 0) {
      throw new MarketDataError(
        `yahoo returned no usable candles for ${symbol} (${interval})`,
        'upstream',
      );
    }

    const aggregated =
      factor > 1 ? aggregate(cleanNative, TIMEFRAME_MS[request.timeframe]) : cleanNative;
    const trimmed = aggregated.slice(-limit);
    // One precision for the whole series, chosen from its own magnitude: a
    // currency pair around 1.09 has its entire daily range inside the third
    // decimal, so rounding FX to two decimals would collapse every candle to a
    // single flat value. This mirrors the frontend's `pricePrecision`.
    const decimals = decimalsForPrice((trimmed[trimmed.length - 1] as Candle).close);
    const candles = trimmed.map((candle) => ({
      ...candle,
      open: round(candle.open, decimals),
      high: round(candle.high, decimals),
      low: round(candle.low, decimals),
      close: round(candle.close, decimals),
    }));

    const newest = candles[candles.length - 1] as Candle;
    const closeTime = newest.time + TIMEFRAME_MS[request.timeframe];

    return {
      symbol: request.symbol,
      tvSymbol: request.tvSymbol,
      assetClass: request.assetClass,
      timeframe: request.timeframe,
      candles,
      lastCandleStatus: newestCandleStatus(closeTime, now),
      source: { provider: this.id, mode: 'live', fetchedAt: new Date(now).toISOString() },
    };
  }

  private async requestChart(
    symbol: string,
    interval: string,
    period1: number,
    period2: number,
  ): Promise<YahooChartResponse> {
    const url = new URL(`${this.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set('period1', String(period1));
    url.searchParams.set('period2', String(period2));
    url.searchParams.set('interval', interval);
    url.searchParams.set('includePrePost', 'false');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.marketData.timeoutMs);

    let payload: unknown;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          // Yahoo regularly rejects the bare server user-agent.
          'user-agent': 'Mozilla/5.0 (compatible; NEXORA/0.1)',
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new MarketDataError(
          `yahoo responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
          'upstream',
        );
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      log.warn('Yahoo request failed', { symbol, interval, reason });
      throw new MarketDataError(`yahoo request failed: ${reason}`, 'upstream', error);
    } finally {
      clearTimeout(timer);
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new MarketDataError('yahoo returned an unexpected payload shape', 'upstream');
    }

    const chart = (payload as YahooChartResponse).chart;
    if (chart?.error) {
      throw new MarketDataError(
        `yahoo rejected the request: ${chart.error.description ?? chart.error.code ?? 'unknown error'}`,
        'upstream',
      );
    }
    return payload as YahooChartResponse;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.marketData.timeoutMs, 4_000));
    try {
      const url = new URL(`${this.baseUrl}/v8/finance/chart/AAPL`);
      url.searchParams.set('range', '5d');
      url.searchParams.set('interval', '1d');

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; NEXORA/0.1)',
        },
      });
      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      const payload = (await response.json()) as YahooChartResponse;
      const hasResult = Array.isArray(payload.chart?.result) && payload.chart.result.length > 0;
      return hasResult
        ? { ok: true, detail: `${this.baseUrl} reachable` }
        : { ok: false, detail: 'chart response carried no result' };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convert a Yahoo chart reply into candles, skipping gaps (null OHLC rows). */
function yahooToCandles(payload: YahooChartResponse): Candle[] {
  const result = payload.chart?.result?.[0];
  const times = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) return [];

  const opens = quote.open ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  const candles: Candle[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const open = Number(opens[index]);
    const high = Number(highs[index]);
    const low = Number(lows[index]);
    const close = Number(closes[index]);
    // Yahoo emits `null` for bars with no trade (holidays, halted sessions).
    if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) {
      continue;
    }
    const volume = Number(volumes[index] ?? 0);
    candles.push({
      time: Number(times[index]) * 1_000,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
    });
  }
  return candles;
}

/** Fold `factor` consecutive candles into one, aligned to the epoch. */
function aggregate(candles: Candle[], bucketMs: number): Candle[] {
  const buckets = new Map<number, Candle>();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / bucketMs) * bucketMs;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, { ...candle, time: bucketTime });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/**
 * Same conservative rule as the other providers: a bar whose computed close time
 * is still ahead of our clock cannot have closed, so it is `forming`; anything
 * else is `unknown` rather than an unsupported claim of `closed`.
 */
function newestCandleStatus(closeTime: number, now: number): LastCandleStatus {
  return closeTime > now ? 'forming' : 'unknown';
}

/**
 * Decimal places appropriate for a price of this magnitude. Kept identical to
 * the frontend formatter (`frontend/src/lib/format.ts:pricePrecision`) so the
 * candles the API returns are rounded exactly the way the UI will display them.
 */
function decimalsForPrice(value: number): number {
  const absolute = Math.abs(value);
  if (absolute >= 100) return 2;
  if (absolute >= 1) return 4;
  if (absolute >= 0.01) return 5;
  return 8;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
