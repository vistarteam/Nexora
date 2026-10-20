import { config } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import type {
  AssetClass,
  Candle,
  CandleSeries,
  DataMode,
  PriceDefinition,
  TickerFreshness,
  TickerSnapshot,
  TickerTransport,
  Timeframe,
} from '../../types/domain.js';
import { BinanceMarketDataProvider, NullMarketDataProvider } from './binanceProvider.js';
import { CompositeMarketDataProvider } from './compositeProvider.js';
import { NobitexMarketDataProvider } from './nobitexProvider.js';
import { YahooMarketDataProvider } from './yahooProvider.js';
import { TIMEFRAME_MS, resolveSymbol } from './catalog.js';
import {
  MarketDataError,
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
  type TickerTick,
} from './types.js';

const log = createLogger('market-data');

export * from './types.js';
export * from './catalog.js';
export { BinanceMarketDataProvider, NullMarketDataProvider } from './binanceProvider.js';
export { NobitexMarketDataProvider } from './nobitexProvider.js';
export { YahooMarketDataProvider } from './yahooProvider.js';
export { CompositeMarketDataProvider, type CompositeRoute } from './compositeProvider.js';

/**
 * Build the provider selected by configuration.
 *
 * `auto` (the default) is the Iran-first setup: crypto candles come from
 * Nobitex, an Iranian exchange, while forex and equities come from a keyless
 * global feed. Both are reachable from Iranian networks without a proxy, which
 * Binance is not.
 */
export function createMarketDataProvider(): MarketDataProvider {
  switch (config.marketData.provider) {
    case 'auto': {
      const yahoo = new YahooMarketDataProvider();
      const composite = new CompositeMarketDataProvider(
        [
          { assetClass: 'crypto', provider: new NobitexMarketDataProvider() },
          { assetClass: 'forex', provider: yahoo },
          { assetClass: 'stocks', provider: yahoo },
        ],
        { id: 'auto', label: 'خودکار (سازگار با اینترنت ایران)' },
      );
      log.info('Using AUTO market-data routing (Iran-first)', { routes: composite.routeSummary });
      return composite;
    }
    case 'nobitex':
      log.info('Using Nobitex market-data provider (live crypto data, Iran)', {
        baseUrl: config.marketData.nobitexBaseUrl || 'https://apiv2.nobitex.ir',
      });
      return new NobitexMarketDataProvider();
    case 'yahoo':
      log.info('Using Yahoo Finance market-data provider (live forex and equities)', {
        baseUrl: config.marketData.yahooBaseUrl || 'https://query1.finance.yahoo.com',
      });
      return new YahooMarketDataProvider();
    case 'binance':
      log.info('Using Binance public market-data provider (live crypto data)', {
        baseUrl: config.marketData.baseUrl || 'https://api.binance.com',
      });
      return new BinanceMarketDataProvider();
    case 'none':
      log.warn('Market data disabled (MARKET_DATA_PROVIDER=none)');
      return new NullMarketDataProvider();
  }
}

export interface GetCandlesInput {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  limit: number;
}

/**
 * How long one REST ticker snapshot is shared.
 *
 * Slightly under a second so a client polling once per second still gets a fresh
 * quote, while several open tabs converge on one upstream call instead of one
 * each.
 */
const TICKER_CACHE_MS = 700;

/** A stream that has not ticked for this long is stale, not live. */
const STREAM_STALE_MS = 10_000;
/** REST-sourced snapshots are refreshed by the client each second; 6s is stale. */
const REST_STALE_MS = 6_000;
/** Close a stream nobody has asked about for this long (one chart, many tabs). */
const STREAM_IDLE_MS = 60_000;

interface TickerCacheEntry {
  at: number;
  value: TickerSnapshot;
}

/**
 * One live feed per instrument/timeframe, shared by every HTTP poller.
 *
 * The REST seed is fetched once so a trade-only stream (Nobitex) has an OHLC
 * bar to fold its last-trade price into. From then on ticks are pushed and the
 * REST path is only a fallback when the stream is unavailable or stale.
 */
interface FeedEntry {
  key: string;
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  connection: 'connecting' | 'connected' | 'disconnected';
  lastError: string | null;
  lastTick: TickerTick | null;
  lastTickCandle: Candle | null;
  lastRestAt: number | null;
  lastCandle: Candle | null;
  unsubscribe: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Candles pulled for a ticker snapshot; two is enough to see the forming bar. */
const TICKER_CANDLES = 2;

/**
 * Application-facing market-data facade.
 *
 * Controllers depend on this, never on a provider directly, so swapping or
 * multiplexing providers (e.g. crypto → Nobitex, forex → Yahoo) is a change in
 * one place.
 */
export class MarketDataService {
  /** Coalesces the >1-per-second REST polling a live chart produces. */
  private readonly tickerCache = new Map<string, TickerCacheEntry>();
  private readonly tickerInFlight = new Map<string, Promise<TickerSnapshot>>();
  /** Shared live feeds, keyed by canonical symbol + timeframe. */
  private readonly feeds = new Map<string, FeedEntry>();

  constructor(private readonly provider: MarketDataProvider = createMarketDataProvider()) {}

  /** Close every live feed. Wired into graceful shutdown. */
  dispose(): void {
    for (const feed of this.feeds.values()) {
      if (feed.idleTimer) clearTimeout(feed.idleTimer);
      feed.unsubscribe?.();
    }
    this.feeds.clear();
  }

  get providerInfo(): {
    id: string;
    label: string;
    mode: DataMode;
    supports: readonly AssetClass[];
  } {
    return {
      id: this.provider.id,
      label: this.provider.label,
      mode: this.provider.mode,
      supports: this.provider.supports,
    };
  }

  async fetchCandles(input: GetCandlesInput): Promise<CandleSeries> {
    const resolved = resolveSymbol(input.symbol, input.assetClass);
    const request: CandleRequest = {
      symbol: resolved.symbol,
      tvSymbol: resolved.tvSymbol,
      // `resolveSymbol` returns the catalog entry itself for a listed symbol, so
      // `resolved.assetClass` is the class the instrument *actually* belongs to;
      // only off-catalog symbols fall back to what the caller claimed. Trusting
      // the caller here would let a stale URL or a mis-set default route gold
      // through the crypto venue (and vice versa) and produce an upstream error
      // or, worse, a report filed under the wrong asset class.
      assetClass: resolved.assetClass,
      timeframe: input.timeframe,
      limit: input.limit,
    };

    try {
      const series = await this.provider.fetchCandles(request);
      return { ...series, candles: sanitizeCandles(series.candles) };
    } catch (error) {
      throw toApiError(error, request);
    }
  }

  /**
   * Live snapshot of one instrument: newest price, the forming candle, and when
   * that candle closes.
   *
   * A provider that implements `subscribeTicker` is asked for a public stream.
   * The first response is still seeded from REST, because a trade-only stream
   * carries no OHLC; subsequent responses come from pushed ticks. Providers
   * without a documented stream keep the REST path, and that is reported as
   * `rest-polling` — never mislabelled as a socket feed.
   */
  async ticker(input: Omit<GetCandlesInput, 'limit'>): Promise<TickerSnapshot> {
    const resolved = resolveSymbol(input.symbol, input.assetClass);
    const key = `${resolved.symbol}|${resolved.assetClass}|${input.timeframe}`;
    const now = Date.now();
    const feed = this.ensureFeed(resolved, input.timeframe);

    // A fresh pushed tick is the best available value.
    if (feed?.lastTick && now - feed.lastTick.receivedAt <= STREAM_STALE_MS) {
      this.touchFeed(feed);
      return this.snapshotFromTick(feed, feed.lastTick, now);
    }

    const cached = this.tickerCache.get(key);
    if (cached && now - cached.at < TICKER_CACHE_MS) {
      this.touchFeed(feed);
      return cached.value;
    }

    // Share one upstream call between concurrent pollers.
    const pending = this.tickerInFlight.get(key);
    if (pending) {
      this.touchFeed(feed);
      return pending;
    }

    const request = this.buildTicker(resolved.symbol, resolved.assetClass, input.timeframe, feed)
      .then((value) => {
        this.tickerCache.set(key, { at: Date.now(), value });
        if (feed) {
          feed.lastRestAt = Date.now();
          feed.lastCandle = value.candle ?? feed.lastCandle;
        }
        return value;
      })
      .catch((error: unknown) => {
        // The stream may still hold a recent value even when REST just failed.
        if (feed?.lastTick) {
          const stale = this.snapshotFromTick(feed, feed.lastTick, Date.now(), (error as Error).message);
          this.tickerCache.set(key, { at: Date.now(), value: stale });
          return stale;
        }
        throw error;
      })
      .finally(() => {
        this.tickerInFlight.delete(key);
      });

    this.tickerInFlight.set(key, request);
    this.touchFeed(feed);
    return request;
  }

  /**
   * Lazily open the shared stream for one instrument. Idempotent: a second
   * caller reuses the same feed, so several open tabs never create several
   * exchange connections for the same market.
   */
  private ensureFeed(
    resolved: ReturnType<typeof resolveSymbol>,
    timeframe: Timeframe,
  ): FeedEntry | null {
    if (!this.provider.subscribeTicker) return null;
    const key = `${resolved.symbol}|${resolved.assetClass}|${timeframe}`;
    const existing = this.feeds.get(key);
    if (existing) return existing;

    const feed: FeedEntry = {
      key,
      symbol: resolved.symbol,
      tvSymbol: resolved.tvSymbol,
      assetClass: resolved.assetClass,
      timeframe,
      connection: 'connecting',
      lastError: null,
      lastTick: null,
      lastTickCandle: null,
      lastRestAt: null,
      lastCandle: null,
      unsubscribe: null,
      idleTimer: null,
    };
    this.feeds.set(key, feed);
    this.scheduleIdleClose(feed);

    try {
      feed.unsubscribe = this.provider.subscribeTicker(
        {
          symbol: resolved.symbol,
          tvSymbol: resolved.tvSymbol,
          assetClass: resolved.assetClass,
          timeframe,
        },
        {
          onStatus: (status, detail) => {
            feed.connection = status;
            if (status === 'disconnected' && detail) feed.lastError = detail;
            if (status === 'connected') feed.lastError = null;
          },
          onTick: (tick) => this.acceptTick(feed, tick),
        },
      );
    } catch (error) {
      feed.connection = 'disconnected';
      feed.lastError = (error as Error).message;
    }
    return feed;
  }

  private acceptTick(feed: FeedEntry, tick: TickerTick): void {
    // Providers already validate, but the service is the last gate before state.
    const candle = tick.candle ? (sanitizeCandles([tick.candle])[0] ?? null) : null;
    let nextCandle = feed.lastCandle;

    if (candle) {
      if (!nextCandle || candle.time > nextCandle.time) nextCandle = candle;
      else if (candle.time === nextCandle.time) {
        nextCandle = {
          ...nextCandle,
          high: Math.max(nextCandle.high, candle.high),
          low: Math.min(nextCandle.low, candle.low),
          close: candle.close,
          // Exchange candle volume is authoritative for the bar; never sum two
          // snapshots of the same forming bar.
          volume: Math.max(nextCandle.volume, candle.volume),
        };
      }
    } else if (nextCandle && Number.isFinite(tick.price) && tick.price > 0) {
      // Trade-only stream (Nobitex): fold the last trade into the current bar
      // while preserving every OHLC invariant.
      const interval = TIMEFRAME_MS[feed.timeframe];
      const tradeVolume =
        Number.isFinite(tick.tradeVolume) && (tick.tradeVolume ?? 0) > 0 ? tick.tradeVolume! : 0;

      if (tick.receivedAt >= nextCandle.time + interval) {
        // The held bar closed while the stream was running. Starting a fresh bar
        // at the aligned boundary is the only honest option for a trade-only
        // feed: folding a new trade into yesterday's bar would leave the chart
        // showing a closed candle as the forming one, with a countdown stuck at
        // zero. The new bar opens at this trade and is refined by every tick
        // that follows.
        const elapsed = tick.receivedAt - nextCandle.time;
        const boundary = nextCandle.time + interval * Math.floor(elapsed / interval);
        nextCandle = {
          time: boundary,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tradeVolume,
        };
      } else {
        nextCandle = {
          ...nextCandle,
          high: Math.max(nextCandle.high, tick.price),
          low: Math.min(nextCandle.low, tick.price),
          close: tick.price,
          // Trades are individual sizes, so they add up. By contrast a candle
          // frame's volume is the exchange's cumulative bar total and must
          // never be summed (see above).
          volume: nextCandle.volume + tradeVolume,
        };
      }
    }

    if (!nextCandle) return;
    feed.lastCandle = nextCandle;
    feed.lastTickCandle = candle;
    feed.lastTick = {
      ...tick,
      candle,
      price: Number.isFinite(tick.price) && tick.price > 0 ? tick.price : nextCandle.close,
    };
  }

  private snapshotFromTick(
    feed: FeedEntry,
    tick: TickerTick,
    now: number,
    error: string | null = null,
  ): TickerSnapshot {
    const candle = feed.lastCandle ?? tick.candle;
    const closeTime = candle ? candle.time + TIMEFRAME_MS[feed.timeframe] : null;
    const price = Number.isFinite(tick.price) && tick.price > 0 ? tick.price : candle?.close ?? null;
    const stale = now - tick.receivedAt > STREAM_STALE_MS;
    const warnings: string[] = [];
    if (stale) warnings.push('آخرین پیام جریان بازار قدیمی است؛ مقدار نمایش‌داده‌شده تازه نیست.');
    if (error) warnings.push(`دریافت REST ناموفق بود: ${error}`);
    if (feed.connection !== 'connected') {
      warnings.push('جریان وب‌سوکت متصل نیست؛ آخرین مقدار معلوم نمایش داده می‌شود.');
    }

    return {
      symbol: feed.symbol,
      tvSymbol: feed.tvSymbol,
      assetClass: feed.assetClass,
      timeframe: feed.timeframe,
      price,
      candle,
      candleOpenTime: candle ? candle.time : null,
      candleCloseTime: closeTime,
      candleCloseAt: closeTime === null ? null : new Date(closeTime).toISOString(),
      secondsToClose: closeTime === null ? null : Math.round((closeTime - now) / 1000),
      ...(candle
        ? { lastCandleStatus: closeTime !== null && closeTime > now ? ('forming' as const) : ('unknown' as const) }
        : {}),
      dataSource: tick.venue ?? this.provider.id,
      mode: 'live',
      fetchedAt: new Date(tick.receivedAt).toISOString(),
      freshness: freshness({
        transport: 'websocket',
        venue: tick.venue ?? this.provider.id,
        priceDefinition: tick.priceDefinition,
        eventTime: tick.eventTime,
        receivedAt: tick.receivedAt,
        lastRestSyncAt: feed.lastRestAt,
        connection: feed.connection,
        staleAfterMs: STREAM_STALE_MS,
        lastError: error ?? feed.lastError,
        warnings,
      }),
    };
  }

  private async buildTicker(
    symbol: string,
    assetClass: AssetClass,
    timeframe: Timeframe,
    feed: FeedEntry | null,
  ): Promise<TickerSnapshot> {
    const series = await this.fetchCandles({
      symbol,
      assetClass,
      timeframe,
      limit: TICKER_CANDLES,
    });

    const candle = series.candles[series.candles.length - 1] ?? null;
    const closeTime = candle ? candle.time + TIMEFRAME_MS[series.timeframe] : null;
    const now = Date.now();
    const warnings: string[] = [];
    if (feed && feed.connection === 'connecting') {
      warnings.push('در حال اتصال به جریان وب‌سوکت؛ این مقدار از REST خوانده شده است.');
    }
    if (feed && feed.connection === 'disconnected' && feed.lastError) {
      warnings.push(`جریان وب‌سوکت در دسترس نیست (${feed.lastError})؛ از REST استفاده می‌شود.`);
    }

    return {
      symbol: series.symbol,
      tvSymbol: series.tvSymbol,
      assetClass: series.assetClass,
      timeframe: series.timeframe,
      price: candle ? candle.close : null,
      candle,
      candleOpenTime: candle ? candle.time : null,
      candleCloseTime: closeTime,
      candleCloseAt: closeTime === null ? null : new Date(closeTime).toISOString(),
      secondsToClose: closeTime === null ? null : Math.round((closeTime - now) / 1000),
      ...(series.lastCandleStatus ? { lastCandleStatus: series.lastCandleStatus } : {}),
      dataSource: series.source.provider,
      mode: series.source.mode,
      fetchedAt: new Date(now).toISOString(),
      freshness: freshness({
        transport: 'rest-polling',
        venue: series.source.provider,
        priceDefinition: 'forming_candle_close',
        eventTime: null,
        receivedAt: now,
        lastRestSyncAt: now,
        connection: feed ? feed.connection : 'polling',
        staleAfterMs: REST_STALE_MS,
        lastError: feed?.lastError ?? null,
        warnings,
      }),
    };
  }

  private touchFeed(feed: FeedEntry | null): void {
    if (!feed) return;
    this.scheduleIdleClose(feed);
  }

  private scheduleIdleClose(feed: FeedEntry): void {
    if (feed.idleTimer) clearTimeout(feed.idleTimer);
    feed.idleTimer = setTimeout(() => {
      if (!this.feeds.has(feed.key)) return;
      feed.unsubscribe?.();
      feed.unsubscribe = null;
      this.feeds.delete(feed.key);
      log.debug('closing idle ticker stream', { symbol: feed.symbol, timeframe: feed.timeframe });
    }, STREAM_IDLE_MS);
    feed.idleTimer.unref?.();
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      return await this.provider.health();
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }
}

function freshness(input: {
  transport: TickerTransport;
  venue: string;
  priceDefinition: PriceDefinition;
  eventTime: number | null;
  receivedAt: number;
  lastRestSyncAt: number | null;
  connection: TickerFreshness['connection'];
  staleAfterMs: number;
  lastError: string | null;
  warnings: string[];
}): TickerFreshness {
  const ageMs = Math.max(0, Date.now() - input.receivedAt);
  return { ...input, ageMs, isStale: ageMs > input.staleAfterMs };
}

function toApiError(error: unknown, request: CandleRequest): ApiError {
  if (error instanceof MarketDataError) {
    const context = { symbol: request.symbol, timeframe: request.timeframe, kind: error.kind };
    switch (error.kind) {
      case 'unsupported':
        return new ApiError(422, 'NOT_CONFIGURED', error.message, { logContext: context });
      case 'invalid_symbol':
        return new ApiError(400, 'BAD_REQUEST', error.message, { logContext: context });
      case 'not_configured':
        return new ApiError(503, 'NOT_CONFIGURED', error.message, { logContext: context });
      case 'upstream':
      default:
        return new ApiError(502, 'UPSTREAM_UNAVAILABLE', error.message, { logContext: context });
    }
  }

  log.error('Unexpected market-data failure', { reason: (error as Error).message });
  return ApiError.internal('Market data could not be retrieved');
}
