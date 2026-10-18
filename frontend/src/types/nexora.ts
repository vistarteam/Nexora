/**
 * Frontend mirror of the backend contract.
 *
 * Kept deliberately in sync with `backend/src/types/domain.ts`. When the API
 * contract changes, change both — the compiler then flags every call site.
 */

export type AssetClass = 'crypto' | 'forex' | 'stocks';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
export type DataMode = 'live' | 'none';
export type AnalysisStatus = 'ok' | 'insufficient_data' | 'unavailable';
export type EngineId = 'python' | 'typescript-fallback';

export const ASSET_CLASSES: readonly AssetClass[] = ['crypto', 'forex', 'stocks'];
export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

export interface MarketSymbol {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  venue: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  source: { provider: string; mode: 'live'; fetchedAt: string };
  candles: Candle[];
  count: number;
  /**
   * Evidence-based hint about the newest candle. Mirrors the backend
   * `LastCandleStatus`; absent when the provider cannot support the inference.
   */
  lastCandleStatus?: 'forming' | 'unknown';
}

/**
 * A live snapshot of one instrument, polled once a second by a live chart.
 *
 * Mirrors the backend `TickerSnapshot`. The forming `candle` and its
 * `candleCloseTime` come from the same venue the analysis used, so the animated
 * bar is the very bar the engine last analysed.
 */
export interface TickerSnapshot {
  symbol: string;
  tvSymbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  price: number | null;
  candle: Candle | null;
  candleOpenTime: number | null;
  candleCloseTime: number | null;
  candleCloseAt: string | null;
  secondsToClose: number | null;
  lastCandleStatus?: 'forming' | 'unknown';
  dataSource: string;
  mode: DataMode;
  fetchedAt: string;
}

export interface IndicatorSnapshot {
  value: number | null;
  state?: string;
  signal?: 'bullish' | 'bearish' | 'neutral';
}

export interface MovingAverageSnapshot extends IndicatorSnapshot {
  period: number;
}

export interface LevelTouchpoint { time: number; price: number; type: 'support' | 'resistance'; strength: number; }

export interface SupportResistanceLevel {
  price: number;
  touchpoints?: LevelTouchpoint[];
  touches: number;
  distancePercent: number;
  kind: 'swing' | 'pivot';
}

export interface AnalysisFacts {
  lastCandle: Candle | null;
  candleCount: number;
  changePercent: number | null;
  /** Whole-series close-to-close return stdev; the trend evidence quotes a
   *  separate trend-window figure, each clearly labelled in Persian. */
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
    direction: string;
    strength: number | null;
    evidence: string[];
    higherHighs: boolean | null;
    higherLows: boolean | null;
  } | null;
  levels: {
    supports: SupportResistanceLevel[];
    resistances: SupportResistanceLevel[];
    nearestSupport: SupportResistanceLevel | null;
    nearestResistance: SupportResistanceLevel | null;
  } | null;
}

export interface AnalysisInterpretation {
  summary: string;
  trendReading: string;
  momentumReading: string;
  volatilityReading: string;
  caveats: string[];
}

export interface AnalysisScenario {
  id: string;
  title: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  condition: string;
  invalidation: string;
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
  dataTimestamp: string | null;
  mode: DataMode;
  dataSource: string;
  engine: { id: EngineId; name: string; version: string };
  status: AnalysisStatus;
  facts: AnalysisFacts | null;
  interpretation: AnalysisInterpretation | null;
  scenarios: AnalysisScenario[];
  warnings: string[];
  disclaimer: string;
}

/** One point of a chart line, addressed by the candle's open time (epoch ms). */
export interface ChartPoint {
  time: number;
  value: number;
}

/** A moving-average line drawn over the candles. */
export interface ChartOverlay {
  /** Stable id, e.g. `sma20`. */
  id: string;
  kind: 'sma' | 'ema';
  period: number;
  points: ChartPoint[];
}

/**
 * Everything the price chart draws, computed by the analysis engine from the
 * exact candles it analysed.
 *
 * Because it arrives with the report (or from `/api/chart`, which runs the same
 * engine), the chart and the text can never describe different data — the chart
 * shows the engine's own numbers, not a third-party picture of a different venue
 * and interval.
 */
export interface ChartPayload {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  generatedAt: string;
  mode: DataMode;
  dataSource: string;
  lastCandleStatus?: 'forming' | 'unknown';
  engine: { id: EngineId; name: string; version: string };
  status: AnalysisStatus;
  reason: string | null;
  warnings: string[];
  candles: Candle[];
  overlays: ChartOverlay[];
  indicators: {
    rsi: {
      period: number;
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
    regression: { from: ChartPoint; to: ChartPoint } | null;
  } | null;
}

/** A line the user drew on the chart, persisted per symbol and timeframe. */
export type ChartDrawing =
  | { id: string; kind: 'hline'; price: number }
  | { id: string; kind: 'trend'; from: ChartPoint; to: ChartPoint };

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
  price: number | null;
  trendDirection: string | null;
}

export interface WatchlistItem {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: AssetClass;
  addedAt: string;
}

/** Metadata envelope attached to every API response. */
export interface ApiMeta {
  generatedAt: string;
  persistent?: boolean;
  storage?: string;
  notices?: string[];
}

export interface ApiFieldIssue {
  path: string;
  message: string;
}

export type ApiResponse<T> =
  | { ok: true; data: T; meta: ApiMeta }
  | { ok: false; error: { code: string; message: string; details?: ApiFieldIssue[] }; meta: ApiMeta };

export interface MarketsPayload {
  items: MarketSymbol[];
  assetClasses: Array<{ id: AssetClass; label: string; count: number }>;
  total: number;
}

export interface HealthPayload {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  environment: string;
  checks: {
    api: 'ok';
    analysisEngine: {
      status: 'available' | 'unavailable';
      executable: string;
      id: 'python' | 'typescript-fallback';
      detail?: string;
    };
    marketData: { provider: string; mode: DataMode; detail?: string };
    storage: { driver: string; persistent: boolean; detail?: string };
  };
}

export interface BootstrapPayload {
  defaults: { symbol: string; timeframe: Timeframe };
  assetClasses: Array<{ id: AssetClass; label: string }>;
  timeframes: Timeframe[];
  marketData: {
    provider: string;
    label: string;
    mode: DataMode;
    supports: AssetClass[];
  };
  analysis: {
    engine: string;
    typeScriptFallbackEnabled: boolean;
    disclaimer: string;
  };
  storage: { driver: string; persistent: boolean };
}
