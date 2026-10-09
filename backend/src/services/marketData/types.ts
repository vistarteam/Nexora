import type { AssetClass, Candle, CandleSeries, DataMode, Timeframe } from '../../types/domain.js';

export interface CandleRequest {
  /** Canonical NEXORA symbol, e.g. `BINANCE:BTCUSDT`. */
  symbol: string;
  /** TradingView ticker for the same instrument. */
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  /** Maximum number of candles to return; providers may cap lower. */
  limit: number;
}

/**
 * Every market-data source implements this interface.
 *
 * Provider-specific details (auth, pagination, symbol grammar, rate limits)
 * must stay inside the provider. Nothing else in the application knows whether
 * candles came from Binance, Twelve Data, PostgreSQL or the demo generator.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  /** `live` providers return real market data; `demo` providers never do. */
  readonly mode: Exclude<DataMode, 'none'>;
  /** Asset classes this provider is able to serve. */
  readonly supports: readonly AssetClass[];
  fetchCandles(request: CandleRequest): Promise<CandleSeries>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Raised when a provider cannot serve a request for a reason the caller can
 * act on (unsupported asset class, unknown symbol, missing credentials).
 */
export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly kind: 'unsupported' | 'not_configured' | 'upstream' | 'invalid_symbol',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

/** Convenience for providers: assert the requested asset class is supported. */
export function assertSupports(
  provider: MarketDataProvider,
  assetClass: AssetClass,
  symbol: string,
): void {
  if (!provider.supports.includes(assetClass)) {
    throw new MarketDataError(
      `provider "${provider.id}" does not serve asset class "${assetClass}" (requested ${symbol})`,
      'unsupported',
    );
  }
}

/** Validate a raw provider candle array before it reaches the analysis engine. */
export function sanitizeCandles(candles: Candle[]): Candle[] {
  return candles
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number.isFinite(candle.volume) ? candle.volume : 0,
    }))
    .sort((a, b) => a.time - b.time);
}
