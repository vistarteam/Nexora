import type {
  AnalysisFacts,
  AnalysisInterpretation,
  AnalysisScenario,
  AnalysisStatus,
  EngineId,
  MarketProjection,
} from '../../types/domain.js';

/**
 * The result of one engine run.
 *
 * Both the Python bridge and the TypeScript reference implementation return
 * this exact shape, so nothing downstream needs to know which one ran — except
 * `engine.id`, which is always recorded and shown in the UI.
 */
export interface EngineRunResult {
  engine: { id: EngineId; name: string; version: string };
  status: AnalysisStatus;
  requiredCandles: number;
  receivedCandles: number;
  facts: AnalysisFacts | null;
  interpretation: AnalysisInterpretation | null;
  scenarios: AnalysisScenario[];
  /** Experimental conditional projection, when the data supports one. */
  projection?: MarketProjection | null;
  /** Chart-renderable indicator series; `null` unless `includeSeries` was set. */
  series: EngineSeries | null;
  warnings: string[];
  /** Persian explanation, present whenever `status !== 'ok'`. */
  reason: string | null;
}

/** One detected swing point, identified by its index in the candle series. */
export interface EngineSwingPoint {
  index: number;
  price: number;
}

/**
 * Every indicator value for every bar, aligned to the candle index.
 *
 * Produced only when `includeSeries` is requested: a caller that just wants the
 * report should not pay to transport hundreds of numbers it will not draw. Each
 * array has exactly `count` entries, entry `i` belongs to `candles[i]`, and
 * `null` marks the warm-up region where the indicator is not yet defined.
 *
 * The last defined value of each array is the same number `facts.indicators`
 * reports for the newest bar, because both come from the same functions — so a
 * chart drawn from this block can never contradict the text report.
 */
export interface EngineSeries {
  count: number;
  sma: Record<string, (number | null)[]>;
  ema: Record<string, (number | null)[]>;
  rsi: (number | null)[];
  macd: {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
  };
  atr: (number | null)[];
  swings: { highs: EngineSwingPoint[]; lows: EngineSwingPoint[] };
  /** Least-squares trend line over the most recent window of closes. */
  regression: {
    slope: number;
    intercept: number;
    window: number;
    startIndex: number;
  } | null;
}

/** Indicator options, mirroring `nexora_analysis.engine.DEFAULT_OPTIONS`. */
export interface EngineOptions {
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  smaPeriods: number[];
  emaPeriods: number[];
  atrPeriod: number;
  swingLookback: number;
  maxLevels: number;
  /** Also return every indicator value for every bar (chart payload). */
  includeSeries?: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  smaPeriods: [20, 50, 200],
  emaPeriods: [9, 21, 55],
  atrPeriod: 14,
  swingLookback: 5,
  maxLevels: 5,
  includeSeries: false,
};

/** Raised when the payload shape itself is invalid (not merely too short). */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/** Shape of the JSON object the Python CLI prints on stdout. */
export type EngineStdoutPayload = Partial<EngineRunResult> & {
  engine?: { id?: string; name?: string; version?: string };
};
