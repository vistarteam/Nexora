import { config } from '../../config/env.js';
import type { Candle, CandleSeries, LastCandleStatus, Timeframe } from '../../types/domain.js';
import { createLogger } from '../../lib/logger.js';
import { TIMEFRAME_MS } from './catalog.js';
import {
  assertSupports,
  MarketDataError,
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
  type TickerStreamHandlers,
} from './types.js';
import { NOBITEX_STREAM_RESOLUTION, NobitexTickerStream } from './streams.js';

const log = createLogger('market-data:nobitex');

/**
 * Real market data from Nobitex, an Iranian exchange whose API is reachable from
 * Iranian networks without a proxy (unlike Binance's public REST API).
 *
 * Candles come from the TradingView-UDF endpoint `GET /market/udf/history`, which
 * is public and needs no API key. It only serves crypto pairs and is restricted
 * to the `NOBITEX:*` (and, as a convenience, the `BINANCE:*`) namespace.
 *
 * Two upstream quirks are handled here so the rest of the application never sees
 * them:
 *
 *   - timestamps are returned in **seconds**, while the domain uses epoch
 *     milliseconds,
 *   - the endpoint caps one reply at {@link PAGE_SIZE} candles and has no weekly
 *     resolution, so long windows are paged backwards and `1w` is aggregated from
 *     daily bars.
 */
const NOBITEX_RESOLUTION: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  // Nobitex has no weekly resolution, only daily and up to 3-day bars.
  '1w': 'D',
};

/** Timeframes assembled from a finer native resolution (native bars per output bar). */
const NATIVE_FACTOR: Partial<Record<Timeframe, number>> = { '1w': 7 };

/** One upstream reply carries at most this many candles. */
const PAGE_SIZE = 500;
/** Hard ceiling on pages per request, so a bad cursor cannot loop forever. */
const MAX_PAGES = 6;
/** Upper bound on candles fetched from upstream (before aggregation). */
const MAX_NATIVE_CANDLES = 3_000;

interface UdfHistoryResponse {
  s?: string;
  t?: unknown[];
  o?: unknown[];
  h?: unknown[];
  l?: unknown[];
  c?: unknown[];
  v?: unknown[];
  errmsg?: string;
}

export interface NobitexProviderOptions {
  /** Override the API origin (tests point this at a stub). */
  baseUrl?: string;
  /** Injectable clock, so the paging cursor and newest-bar hint are testable. */
  now?: () => number;
}

export class NobitexMarketDataProvider implements MarketDataProvider {
  readonly id = 'nobitex';
  readonly label = 'نوبیتکس (ایران)';
  readonly mode = 'live' as const;
  readonly supports = ['crypto'] as const;

  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(options: NobitexProviderOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      config.marketData.nobitexBaseUrl ||
      'https://apiv2.nobitex.ir'
    ).replace(/\/+$/, '');
    this.now = options.now ?? (() => Date.now());
  }

  /** Native ticker for the provider's public endpoints (REST and WebSocket). */
  nativeTicker(symbol: string): string {
    return this.toNobitexSymbol(symbol);
  }

  private toNobitexSymbol(symbol: string): string {
    const hasPrefix = symbol.includes(':');
    const prefix = hasPrefix ? (symbol.split(':', 2)[0] ?? '').toUpperCase() : '';
    const ticker = (
      hasPrefix ? (symbol.split(':', 2)[1] ?? '') : symbol
    ).toUpperCase();

    if (prefix && prefix !== 'NOBITEX' && prefix !== 'BINANCE') {
      throw new MarketDataError(
        `symbol "${symbol}" is not served by the nobitex provider`,
        'invalid_symbol',
      );
    }
    if (!/^[A-Z0-9]{5,20}$/.test(ticker)) {
      throw new MarketDataError(`invalid nobitex symbol "${symbol}"`, 'invalid_symbol');
    }
    return ticker;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    assertSupports(this, request.assetClass, request.symbol);

    const ticker = this.toNobitexSymbol(request.symbol);
    const resolution = NOBITEX_RESOLUTION[request.timeframe];
    const factor = NATIVE_FACTOR[request.timeframe] ?? 1;
    const limit = Math.max(10, Math.min(request.limit, 1_000, config.marketData.maxLimit));
    const target = Math.min(limit * factor, MAX_NATIVE_CANDLES);

    const native = await this.fetchNative(ticker, resolution, target);
    if (native.length === 0) {
      throw new MarketDataError(
        `nobitex returned no usable candles for ${ticker} (${resolution})`,
        'upstream',
      );
    }

    const cleanNative = sanitizeCandles(native);
    if (cleanNative.length === 0) {
      throw new MarketDataError(
        `nobitex returned no usable candles for ${ticker} (${resolution})`,
        'upstream',
      );
    }

    const aggregated =
      factor > 1 ? aggregate(cleanNative, TIMEFRAME_MS[request.timeframe]) : cleanNative;
    const trimmed = aggregated.slice(-limit);

    const decimals = /(?:IRT|RLS)$/.test(ticker) ? 0 : 2;
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
      lastCandleStatus: newestCandleStatus(closeTime, this.now()),
      source: { provider: this.id, mode: 'live', fetchedAt: new Date(this.now()).toISOString() },
    };
  }

  /**
   * Walk backwards through the UDF history endpoint until `count` distinct
   * candles are collected. Each reply must request fewer than {@link PAGE_SIZE}
   * candles, so the cursor is moved before the earliest timestamp already held.
   */
  private async fetchNative(
    ticker: string,
    resolution: string,
    count: number,
  ): Promise<Candle[]> {
    const collected = new Map<number, Candle>();
    let cursorSeconds = Math.floor(this.now() / 1_000);
    let pages = 0;

    while (collected.size < count && pages < MAX_PAGES) {
      const countback = Math.min(PAGE_SIZE, count - collected.size);
      const payload = await this.requestHistory(ticker, resolution, cursorSeconds, countback);
      if (!payload) break;

      const rows = udfToCandles(payload);
      if (rows.length === 0) break;

      let added = 0;
      for (const candle of rows) {
        if (!collected.has(candle.time)) {
          collected.set(candle.time, candle);
          added += 1;
        }
      }

      const earliest = Math.min(...rows.map((row) => row.time));
      const nextCursor = Math.floor(earliest / 1_000) - 1;
      // Guard against a stuck cursor (e.g. upstream echoing the same window).
      if (nextCursor >= cursorSeconds || added === 0) break;
      cursorSeconds = nextCursor;
      pages += 1;
    }

    return [...collected.values()].sort((a, b) => a.time - b.time);
  }

  private async requestHistory(
    ticker: string,
    resolution: string,
    toSeconds: number,
    countback: number,
  ): Promise<UdfHistoryResponse | null> {
    const url = new URL(`${this.baseUrl}/market/udf/history`);
    url.searchParams.set('symbol', ticker);
    url.searchParams.set('resolution', resolution);
    url.searchParams.set('to', String(toSeconds));
    url.searchParams.set('countback', String(countback));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.marketData.timeoutMs);

    let payload: unknown;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new MarketDataError(
          `nobitex responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
          'upstream',
        );
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      log.warn('Nobitex request failed', { symbol: ticker, resolution, reason });
      throw new MarketDataError(`nobitex request failed: ${reason}`, 'upstream', error);
    } finally {
      clearTimeout(timer);
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new MarketDataError('nobitex returned an unexpected payload shape', 'upstream');
    }

    const record = payload as UdfHistoryResponse;
    // An empty window is not an error: the caller stops paging and reports what
    // it already has (or "no usable candles" when nothing was collected).
    if (record.s === 'no_data') return null;
    if (record.s !== 'ok') {
      throw new MarketDataError(
        `nobitex rejected the request: ${record.errmsg ?? record.s ?? 'unknown status'}`,
        'upstream',
      );
    }
    return record;
  }

  /**
   * Public trade/candle stream. Weekly candles are not published by the
   * documented candle channel, so `1w` deliberately falls back to REST.
   */
  subscribeTicker(
    request: Omit<CandleRequest, 'limit'>,
    handlers: TickerStreamHandlers,
  ): () => void {
    if (!config.marketData.streamEnabled) {
      handlers.onStatus('disconnected', 'streams disabled by configuration');
      return () => undefined;
    }
    if (!NOBITEX_STREAM_RESOLUTION[request.timeframe]) {
      handlers.onStatus('disconnected', 'no documented weekly stream; using REST');
      return () => undefined;
    }
    let stream: NobitexTickerStream | null = null;
    try {
      stream = new NobitexTickerStream({
        symbol: request.symbol,
        timeframe: request.timeframe,
        nativeTicker: this.toNobitexSymbol(request.symbol),
        handlers,
      });
      stream.start();
    } catch (error) {
      handlers.onStatus('disconnected', (error as Error).message);
      return () => undefined;
    }
    return () => stream?.close();
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.marketData.timeoutMs, 4_000));
    try {
      const url = new URL(`${this.baseUrl}/market/udf/history`);
      // BTCUSDT is the deepest USDT-quoted pair, so it doubles as an uptime probe.
      // (USDTIRT is deliberately avoided: the UDF history endpoint rejects the
      // IRT-quoted pairs with 403, which would make health look down while the
      // USDT pairs the app actually uses are fine.)
      url.searchParams.set('symbol', 'BTCUSDT');
      url.searchParams.set('resolution', 'D');
      url.searchParams.set('to', String(Math.floor(this.now() / 1_000)));
      url.searchParams.set('countback', '1');

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };

      const payload = (await response.json()) as UdfHistoryResponse;
      return payload.s === 'ok'
        ? { ok: true, detail: `${this.baseUrl} reachable` }
        : { ok: false, detail: `upstream status: ${payload.s ?? 'unknown'}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Convert a UDF parallel-array reply (seconds) into candles (milliseconds). */
function udfToCandles(payload: UdfHistoryResponse): Candle[] {
  const times = Array.isArray(payload.t) ? payload.t : [];
  const opens = Array.isArray(payload.o) ? payload.o : [];
  const highs = Array.isArray(payload.h) ? payload.h : [];
  const lows = Array.isArray(payload.l) ? payload.l : [];
  const closes = Array.isArray(payload.c) ? payload.c : [];
  const volumes = Array.isArray(payload.v) ? payload.v : [];

  const length = Math.min(
    times.length,
    opens.length,
    highs.length,
    lows.length,
    closes.length,
  );

  const candles: Candle[] = [];
  for (let index = 0; index < length; index += 1) {
    candles.push({
      time: Number(times[index]) * 1_000,
      open: Number(opens[index]),
      high: Number(highs[index]),
      low: Number(lows[index]),
      close: Number(closes[index]),
      volume: Number(volumes[index] ?? 0),
    });
  }
  return candles;
}

/**
 * Fold `factor` consecutive candles into one, aligning buckets to the epoch so
 * the output timestamps stay stable regardless of when the fetch happened.
 */
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
 * Nobitex's UDF reply carries no per-candle closed flag; only the exchange's own
 * close time would be authoritative, and it is not exposed. Exactly one inference
 * is safe: a bar whose computed close time is still ahead of our clock cannot
 * have closed yet. The converse is unreliable under clock skew, so a past close
 * time is reported `unknown`, never `closed` — the same conservative rule the
 * Binance provider uses.
 */
function newestCandleStatus(closeTime: number, now: number): LastCandleStatus {
  return closeTime > now ? 'forming' : 'unknown';
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
