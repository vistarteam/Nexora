import type {
  AnalysisFacts,
  AnalysisInterpretation,
  AnalysisScenario,
  AnalysisStatus,
  EngineId,
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
  warnings: string[];
  /** Persian explanation, present whenever `status !== 'ok'`. */
  reason: string | null;
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
