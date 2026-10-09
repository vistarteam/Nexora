import { config } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { createLogger } from '../../lib/logger.js';
import type { AssetClass, CandleSeries, Timeframe } from '../../types/domain.js';
import { BinanceMarketDataProvider, NullMarketDataProvider } from './binanceProvider.js';
import { DemoMarketDataProvider } from './demoProvider.js';
import { resolveSymbol } from './catalog.js';
import {
  MarketDataError,
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
} from './types.js';

const log = createLogger('market-data');

export * from './types.js';
export * from './catalog.js';
export { DemoMarketDataProvider } from './demoProvider.js';
export { BinanceMarketDataProvider, NullMarketDataProvider } from './binanceProvider.js';

/** Build the provider selected by configuration. */
export function createMarketDataProvider(): MarketDataProvider {
  switch (config.marketData.provider) {
    case 'binance':
      log.info('Using Binance public market-data provider (live crypto data)', {
        baseUrl: config.marketData.baseUrl || 'https://api.binance.com',
      });
      return new BinanceMarketDataProvider();
    case 'none':
      log.warn('Market data disabled (MARKET_DATA_PROVIDER=none)');
      return new NullMarketDataProvider();
    case 'demo':
    default:
      log.warn(
        'Using DEMO market data: candles are synthetic and must never be treated as real prices',
      );
      return new DemoMarketDataProvider();
  }
}

export interface GetCandlesInput {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  limit: number;
}

/**
 * Application-facing market-data facade.
 *
 * Controllers depend on this, never on a provider directly, so swapping or
 * multiplexing providers (e.g. crypto → Binance, forex → Twelve Data) is a
 * change in one place.
 */
export class MarketDataService {
  constructor(private readonly provider: MarketDataProvider = createMarketDataProvider()) {}

  get providerInfo(): { id: string; label: string; mode: 'live' | 'demo'; supports: readonly AssetClass[] } {
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
      assetClass: input.assetClass,
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
