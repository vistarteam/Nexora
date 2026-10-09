/**
 * Shared domain types for NEXORA.
 *
 * These types are the single source of truth for the HTTP contract. The
 * frontend mirrors them in `frontend/src/types/nexora.ts` — keep both in sync.
 */

/** Asset classes the platform intends to support. */
export type AssetClass = 'crypto' | 'forex' | 'stocks';

/** Chart timeframes supported by both the data providers and the chart widget. */
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const ASSET_CLASSES: readonly AssetClass[] = ['crypto', 'forex', 'stocks'];
export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

/**
 * How the underlying data was obtained.
 * - `live`  : real data from a configured upstream provider.
 * - `demo`  : deterministic synthetic data generated locally. Never real.
 * - `none`  : no data could be produced.
 */
export type DataMode = 'live' | 'demo' | 'none';

/** A tradable instrument as understood by NEXORA. */
export interface MarketSymbol {
  /** Canonical NEXORA id, e.g. `BINANCE:BTCUSDT`. */
  symbol: string;
  /** TradingView-compatible ticker used by the chart widget. */
  tvSymbol: string;
  /** Human readable name (Persian where a common Persian name exists). */
  name: string;
  assetClass: AssetClass;
  /** Display-only exchange/venue label, e.g. `Binance`, `فارکس`. */
  venue: string;
}

/** A single OHLCV candle. `time` is the candle open time in epoch milliseconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Result of a candle request against a market-data provider. */
export interface CandleSeries {
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  candles: Candle[];
  /** Where the candles came from and whether they are real. */
  source: {
    provider: string;
    mode: Exclude<DataMode, 'none'>;
    /** ISO timestamp of retrieval. */
    fetchedAt: string;
  };
}

/** Which implementation produced an analysis report. */
export type EngineId = 'python' | 'typescript-fallback';

/**
 * Outcome of an analysis run.
 * - `ok`                : enough data, indicators computed.
 * - `insufficient_data` : real data existed but was too short for the indicators.
 * - `unavailable`       : no usable data or the engine could not run.
 */
export type AnalysisStatus = 'ok' | 'insufficient_data' | 'unavailable';

/** Facts are deterministic numbers computed from candles. No interpretation. */
export interface IndicatorSnapshot {
  value: number | null;
  /** Short machine-readable state, e.g. `overbought`, `bullish_cross`. */
  state?: string;
  signal?: 'bullish' | 'bearish' | 'neutral';
}

export interface MovingAverageSnapshot extends IndicatorSnapshot {
  period: number;
}

export interface AnalysisFacts {
  /** Latest closed candle. */
  lastCandle: Candle | null;
  candleCount: number;
  /** Percentage change between the first and last close of the window. */
  changePercent: number | null;
  /** Annualised-free simple volatility: stdev of close-to-close returns. */
  volatilityPercent: number | null;
  indicators: {
    rsi: IndicatorSnapshot | null;
    macd: {
      macd: number | null;
      signal: number | null;
      histogram: number | null;
      state?: string;
      signalDirection?: 'bullish' | 'bearish' | 'neutral';
    } | null;
    sma: MovingAverageSnapshot[];
    ema: MovingAverageSnapshot[];
    atr: IndicatorSnapshot | null;
  };
  trend: {
    /** `uptrend` | `downtrend` | `sideways` | `unknown` */
    direction: string;
    strength: number | null;
    /** Human readable reasons, computed (not opinions). */
    evidence: string[];
    higherHighs: boolean | null;
    higherLows: boolean | null;
  } | null;
  levels: {
    supports: SupportResistanceLevel[];
    resistances: SupportResistanceLevel[];
    /** Nearest level above/below the current price. */
    nearestSupport: SupportResistanceLevel | null;
    nearestResistance: SupportResistanceLevel | null;
  } | null;
}

export interface SupportResistanceLevel {
  price: number;
  /** Number of times price reacted at this level. */
  touches: number;
  /** Absolute distance from the last price, in percent. */
  distancePercent: number;
  /** `swing` | `pivot` — how the level was detected. */
  kind: 'swing' | 'pivot';
}

/** Interpretations are opinions derived from facts. Always labelled as such. */
export interface AnalysisInterpretation {
  summary: string;
  trendReading: string;
  momentumReading: string;
  volatilityReading: string;
  /** Things that make this reading wrong. */
  caveats: string[];
}

/** A hypothetical, conditional scenario. Not a prediction. */
export interface AnalysisScenario {
  id: string;
  title: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  /** Condition that must hold for the scenario to be worth watching. */
  condition: string;
  /** What would invalidate the scenario. */
  invalidation: string;
  /** Confidence is deliberately coarse: low | medium | high. */
  confidence: 'low' | 'medium' | 'high';
}

export interface AnalysisReport {
  id: string;
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  createdAt: string;
  /** Timestamp of the newest candle used. */
  dataTimestamp: string | null;
  /** Mirrors `candleSeries.source.mode`. */
  mode: DataMode;
  dataSource: string;
  engine: {
    id: EngineId;
    name: string;
    version: string;
  };
  status: AnalysisStatus;
  facts: AnalysisFacts | null;
  interpretation: AnalysisInterpretation | null;
  scenarios: AnalysisScenario[];
  /** Non-fatal problems worth surfacing to the user. */
  warnings: string[];
  /** Always present, always shown in the UI. */
  disclaimer: string;
}

export interface WatchlistItem {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  addedAt: string;
}

/** Compact projection of a report for the history list. */
export interface AnalysisSummary {
  id: string;
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  createdAt: string;
  mode: DataMode;
  status: AnalysisStatus;
  engine: EngineId;
  /** Price at the time of analysis, for a quick glance. */
  price: number | null;
  trendDirection: string | null;
}

export const ANALYSIS_DISCLAIMER =
  'این خروجی تحلیل فنی خودکار است و توصیه سرمایه‌گذاری، پیش‌بینی قطعی یا تضمین سود نیست. ' +
  'هر تصمیم معاملاتی بر عهده خود کاربر است.';
