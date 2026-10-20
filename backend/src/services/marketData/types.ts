import type { AssetClass, Candle, CandleSeries, DataMode, Timeframe } from '../../types/domain.js';

/** One validated push from a provider's public market-data stream. */
export interface TickerTick {
  /** Canonical NEXORA symbol (never the provider's native ticker). */
  symbol: string;
  timeframe: Timeframe;
  /** Null for a trade-only frame; the service folds the price into its bar. */
  candle: Candle | null;
  /** Last trade price when the stream carries trades; otherwise candle close. */
  price: number;
  /** What `price` means; never inferred by the consumer. */
  priceDefinition: 'last_trade' | 'forming_candle_close';
  /** Exchange event time in epoch ms, when the message supplies one. */
  eventTime: number | null;
  /**
   * Size of the single trade that produced a trade-only tick.
   *
   * Candle frames already carry cumulative bar volume, so this is only set for
   * trade frames and is what lets the service keep the forming bar's volume
   * meaningful after a period rolls over.
   */
  tradeVolume?: number;
  /** When this process parsed the message. */
  receivedAt: number;
  /** Provider stream identifier, for diagnostics. */
  streamId: string;
  /** Venue that published the tick (e.g. `nobitex`), when the adapter knows it. */
  venue?: string;
}

export type TickerStreamStatus = 'connecting' | 'connected' | 'disconnected';

/** Callbacks a provider must drive when it implements `subscribeTicker`. */
export interface TickerStreamHandlers {
  onTick(tick: TickerTick): void;
  onStatus(status: TickerStreamStatus, detail?: string): void;
}

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
 * candles came from Binance, Nobitex, Yahoo or a test double.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  /**
   * `live` when the provider serves real upstream data; `none` for the null
   * provider, which is configured but deliberately serves nothing.
   */
  readonly mode: DataMode;
  /** Asset classes this provider is able to serve. */
  readonly supports: readonly AssetClass[];
  fetchCandles(request: CandleRequest): Promise<CandleSeries>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  /**
   * Optional public market-data stream. Providers that can push validated
   * ticks implement this; everyone else omits it and the service falls back to
   * REST polling, which is reported honestly as `rest-polling`.
   *
   * The returned function must close the underlying socket and remove every
   * listener. It is safe to call more than once.
   */
  subscribeTicker?(
    request: Omit<CandleRequest, 'limit'>,
    handlers: TickerStreamHandlers,
  ): () => void;
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

/**
 * Validate a raw provider candle array before it reaches the analysis engine.
 *
 * Every rule is purely local — no clock, no network — so a corrupt or
 * mis-scaled upstream row can never reach the indicators:
 *
 *   - each price must be finite and strictly positive; a zero or negative
 *     price is not a tradable quote and would break percentage/log math,
 *   - `high`/`low` must bracket the candle's own open and close,
 *   - `time` must be a safe, positive epoch-millisecond instant. The
 *     `[MIN_EPOCH_MS, MAX_EPOCH_MS)` window spans 2001-09-09 to the year 2286,
 *     which accepts every realistic candle while rejecting the same instant
 *     expressed in seconds (~1.7e9), microseconds (~1.7e15) or nanoseconds
 *     (~1.7e18),
 *   - candles are returned sorted ascending by time with repeated timestamps
 *     collapsed to their first occurrence, so every consecutive step is a
 *     strictly positive interval.
 *
 * Volume is lenient by design (it is not a price): a missing or negative
 * volume is clamped to zero rather than discarding an otherwise valid candle.
 *
 * Rows failing any check are dropped, not thrown on, preserving the "filter"
 * contract; callers decide whether an empty result is an error.
 */
export function sanitizeCandles(candles: Candle[]): Candle[] {
  return candles
    .filter(isValidCandle)
    .map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number.isFinite(candle.volume) && candle.volume > 0 ? candle.volume : 0,
    }))
    .sort((a, b) => a.time - b.time)
    // Drop repeated timestamps after sorting so each kept candle is the first
    // one seen at that open time (stable and deterministic).
    .filter((candle, index, sorted) => index === 0 || sorted[index - 1]!.time !== candle.time);
}

/**
 * Lower bound for a plausible candle open time: 2001-09-09T01:46:40Z, i.e. the
 * first instant whose epoch-millisecond value reaches 1e12. Modern electronic
 * exchange data is always far later, while a seconds-scale timestamp for the
 * same era (~1.7e9) falls well below it.
 */
const MIN_EPOCH_MS = 1e12;
/**
 * Exclusive upper bound (year ~2286). A microsecond (~1.7e15) or nanosecond
 * (~1.7e18) timestamp lands above it, so the pair pins down the millisecond
 * unit without depending on the current date.
 */
const MAX_EPOCH_MS = 1e13;

function isValidCandle(candle: Candle): boolean {
  return (
    Number.isSafeInteger(candle.time) &&
    candle.time >= MIN_EPOCH_MS &&
    candle.time < MAX_EPOCH_MS &&
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close
  );
}
