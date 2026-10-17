import { config } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import type {
  AssetClass,
  CandleSeries,
  DataMode,
  TickerSnapshot,
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
 * How long one ticker snapshot is shared.
 *
 * Slightly under a second so a client polling once per second still gets a fresh
 * quote, while several open tabs converge on one upstream call instead of one
 * each.
 */
const TICKER_CACHE_MS = 700;

interface TickerCacheEntry {
  at: number;
  value: TickerSnapshot;
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
  /** Coalesces the >1-per-second polling a live chart produces. */
  private readonly tickerCache = new Map<string, TickerCacheEntry>();
  private readonly tickerInFlight = new Map<string, Promise<TickerSnapshot>>();

  constructor(private readonly provider: MarketDataProvider = createMarketDataProvider()) {}

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
   * Deliberately built on `fetchCandles` rather than a second, provider-specific
   * "quote" path: the number a chart animates is then produced by exactly the
   * same code that produced the analysis, so the live tape can never disagree
   * with the report about which bar is current.
   */
  async ticker(input: Omit<GetCandlesInput, 'limit'>): Promise<TickerSnapshot> {
    const resolved = resolveSymbol(input.symbol, input.assetClass);
    const key = `${resolved.symbol}|${resolved.assetClass}|${input.timeframe}`;
    const now = Date.now();

    const cached = this.tickerCache.get(key);
    if (cached && now - cached.at < TICKER_CACHE_MS) return cached.value;

    // Share one upstream call between concurrent pollers.
    const pending = this.tickerInFlight.get(key);
    if (pending) return pending;

    const request = this.buildTicker(resolved.symbol, resolved.assetClass, input.timeframe)
      .then((value) => {
        this.tickerCache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        this.tickerInFlight.delete(key);
      });

    this.tickerInFlight.set(key, request);
    return request;
  }

  private async buildTicker(
    symbol: string,
    assetClass: AssetClass,
    timeframe: Timeframe,
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
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      return await this.provider.health();
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }
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
