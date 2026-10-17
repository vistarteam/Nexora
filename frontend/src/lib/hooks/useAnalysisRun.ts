import { useCallback, useState } from 'react';
import { ApiError, api } from '../api';
import type { AnalysisReport, ApiMeta, ChartPayload } from '../../types/nexora';

export type RunPhase = 'idle' | 'running' | 'done' | 'error';

export interface RunState {
  phase: RunPhase;
  report: AnalysisReport | null;
  /**
   * Chart computed from the very same candle series as `report`.
   *
   * Kept beside the report rather than fetched separately so the chart on screen
   * describes the analysis on screen, bar for bar.
   */
  chart: ChartPayload | null;
  error: ApiError | null;
  meta: ApiMeta | null;
  durationMs: number | null;
  saved: boolean;
  /** Echoes the inputs that produced the current report. */
  requested: { symbol: string; assetClass: string; timeframe: string } | null;
}

const INITIAL: RunState = {
  phase: 'idle',
  report: null,
  chart: null,
  error: null,
  meta: null,
  durationMs: null,
  saved: false,
  requested: null,
};

export interface RunInput {
  symbol: string;
  assetClass: string;
  timeframe: string;
  limit?: number;
  save?: boolean;
  /** Defaults to true: the analysis page always wants the chart. */
  includeChart?: boolean;
}

/**
 * Runs an analysis and tracks its lifecycle.
 *
 * Kept separate from `useApi` because a POST is a deliberate user action with
 * its own phases (idle → running → done/error), not a reactive data dependency.
 * The previous report is retained while a new run is in flight so the screen
 * does not flash empty.
 */
export function useAnalysisRun() {
  const [state, setState] = useState<RunState>(INITIAL);

  const run = useCallback(async (input: RunInput): Promise<AnalysisReport | null> => {
    setState((previous) => ({
      ...previous,
      phase: 'running',
      error: null,
      requested: {
        symbol: input.symbol,
        assetClass: input.assetClass,
        timeframe: input.timeframe,
      },
    }));

    try {
      const result = await api.runAnalysis({ ...input, includeChart: input.includeChart ?? true });
      setState({
        phase: 'done',
        report: result.data.report,
        chart: result.data.chart,
        error: null,
        meta: result.meta,
        durationMs: result.data.durationMs,
        saved: result.data.saved,
        requested: {
          symbol: input.symbol,
          assetClass: input.assetClass,
          timeframe: input.timeframe,
        },
      });
      return result.data.report;
    } catch (caught) {
      setState((previous) => ({
        ...previous,
        phase: 'error',
        error:
          caught instanceof ApiError
            ? caught
            : new ApiError('اجرای تحلیل با خطای نامشخص مواجه شد.', { code: 'UNKNOWN' }),
      }));
      return null;
    }
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, run, reset };
}
