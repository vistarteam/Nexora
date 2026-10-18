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
 * - `live` : real data from a configured upstream provider.
 * - `none` : no data could be produced.
 *
 * There is deliberately no synthetic mode: every candle the API serves comes
 * from a real upstream, or the request fails explicitly.
 */
export type DataMode = 'live' | 'none';

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

/**
 * What can honestly be said about the newest candle of a series.
 *
 * The REST `/klines` endpoint exposes no per-kline closed flag (only the
 * websocket stream carries one), so closure can only be *inferred*, and only in
 * one direction: when the exchange-reported close time is still ahead of our own
 * clock the bar cannot have closed yet, so `forming` is certain. The converse is
 * not reliable under clock skew — our clock may lag the exchange — so a bar
 * whose close time already reads in the past is reported `unknown`, never
 * `closed`.
 *
 * Providers that cannot support even this inference omit the field entirely
 * rather than guessing.
 */
export type LastCandleStatus = 'forming' | 'unknown';

/** Result of a candle request against a market-data provider. */
export interface CandleSeries {
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  candles: Candle[];
  /**
   * Evidence-based hint about the newest candle. Absent when the provider cannot
   * support the inference — the field is never a guess.
   */
  lastCandleStatus?: LastCandleStatus;
  /** Where the candles came from and whether they are real. */
  source: {
    provider: string;
    mode: Exclude<DataMode, 'none'>;
    /** ISO timestamp of retrieval. */
    fetchedAt: string;
  };
}

/**
 * A lightweight live snapshot of one instrument.
 *
 * `candle` is the newest — still forming — bar from the *same* provider the
 * analysis uses, and `candleCloseTime` is when that bar rolls over. The snapshot
 * exists so a chart can move every second without re-running the engine or
 * re-downloading the whole history: one small request per second per instrument.
 *
 * Nothing here is estimated: the price is a real quote from the configured venue,
 * or the request fails the same way any other market-data request does.
 */
export interface TickerSnapshot {
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  /** Newest traded price. `null` only when the provider returned no bar at all. */
  price: number | null;
  /** The forming candle, exactly as the provider reported it. */
  candle: Candle | null;
  /** Open time of the forming candle (epoch ms). */
  candleOpenTime: number | null;
  /** When the forming candle closes (open time + the timeframe's duration). */
  candleCloseTime: number | null;
  /** ISO form of {@link candleCloseTime}, ready for display. */
  candleCloseAt: string | null;
  /** Whole seconds until the close. Negative once the bar is overdue. */
  secondsToClose: number | null;
  lastCandleStatus?: LastCandleStatus;
  /** Venue that answered, e.g. `nobitex`. */
  dataSource: string;
  mode: DataMode;
  /** ISO timestamp of this snapshot. */
  fetchedAt: string;
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
  /** Annualised-free simple volatility: population stdev of close-to-close
   *  returns over the *full* supplied series. Distinct from the trend-window
   *  volatility quoted in `facts.trend.evidence`; each is labelled in the
   *  Persian output. */
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

export interface LevelTouchpoint {
  time: number;
  price: number;
  type: 'support' | 'resistance';
  strength: number;
}

export interface SupportResistanceLevel {
  price: number;
  touchpoints?: LevelTouchpoint[];
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

/** One point of a chart line, addressed by the candle's open time. */
export interface ChartPoint {
  time: number;
  value: number;
}

/** A moving-average line the chart draws over the candles. */
export interface ChartOverlay {
  /** Stable id, e.g. `sma20`; the UI uses it as a React key and a toggle id. */
  id: string;
  kind: 'sma' | 'ema';
  period: number;
  points: ChartPoint[];
}

/**
 * Everything the price chart needs, in one payload, computed from one candle
 * series by one engine run.
 *
 * The point of this object is provenance: `candles` are exactly the bars the
 * engine analysed, and every overlay/oscillator/level inside was derived from
 * those same bars by the same functions behind `facts`. A chart drawn from it
 * therefore cannot disagree with the text report shown next to it — the failure
 * mode this replaced (a third-party widget charting a different venue, interval
 * and candle count than the engine analysed).
 */
export interface ChartPayload {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  /** When the candles behind this payload were retrieved. */
  generatedAt: string;
  mode: DataMode;
  /** Venue that supplied the candles, e.g. `nobitex`. */
  dataSource: string;
  lastCandleStatus?: LastCandleStatus;
  engine: { id: EngineId; name: string; version: string };
  /** `ok` means the indicator overlays are complete for this series. */
  status: AnalysisStatus;
  reason: string | null;
  warnings: string[];
  candles: Candle[];
  overlays: ChartOverlay[];
  indicators: {
    rsi: {
      period: number;
      /** Conventional bounds, drawn as reference lines. */
      overbought: number;
      oversold: number;
      points: ChartPoint[];
    } | null;
    macd: {
      fast: number;
      slow: number;
      signalPeriod: number;
      macd: ChartPoint[];
      signal: ChartPoint[];
      histogram: ChartPoint[];
    } | null;
    atr: { period: number; points: ChartPoint[] } | null;
  };
  levels: {
    supports: SupportResistanceLevel[];
    resistances: SupportResistanceLevel[];
    nearestSupport: SupportResistanceLevel | null;
    nearestResistance: SupportResistanceLevel | null;
  } | null;
  swings: { highs: ChartPoint[]; lows: ChartPoint[] } | null;
  trend: {
    direction: string;
    strength: number | null;
    /** Endpoints of the fitted trend line actually used for classification. */
    regression: { from: ChartPoint; to: ChartPoint } | null;
  } | null;
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
