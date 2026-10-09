import { randomUUID } from 'node:crypto';
import { config } from '../../config/env.js';
import { createLogger } from '../../lib/logger.js';
import {
  ANALYSIS_DISCLAIMER,
  type AnalysisReport,
  type AssetClass,
  type CandleSeries,
  type Timeframe,
} from '../../types/domain.js';
import { resolveSymbol, type MarketDataService } from '../marketData/index.js';
import type { HistoryService } from '../historyService.js';
import { analyzeCandles, describeReferenceEngine } from './reference/index.js';
import { PythonEngineUnavailableError, runPythonEngine } from './pythonEngine.js';
import { DEFAULT_ENGINE_OPTIONS, type EngineRunResult } from './types.js';

const log = createLogger('analysis:service');

/** Candles requested per analysis. 300 comfortably exceeds the 205 needed for SMA200. */
export const DEFAULT_ANALYSIS_LIMIT = 300;

export interface RunAnalysisInput {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  limit?: number;
  /** Persist the resulting report. Defaults to true. */
  save?: boolean;
}

export interface RunAnalysisOutput {
  report: AnalysisReport;
  demo: boolean;
  saved: boolean;
  /** Wall-clock duration of the engine call, in milliseconds. */
  durationMs: number;
}

/**
 * Orchestrates one end-to-end analysis:
 *
 *   1. fetch candles from the configured market-data provider,
 *   2. hand them to the analysis engine (Python, with an explicit fallback),
 *   3. compose a report that always states its data mode and engine,
 *   4. optionally persist it.
 *
 * Demo data never gets silently upgraded to look real: the report's `mode`,
 * `dataSource` and `warnings` all carry the distinction to the UI.
 */
export class AnalysisService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly history: HistoryService,
  ) {}

  async run(input: RunAnalysisInput): Promise<RunAnalysisOutput> {
    const startedAt = Date.now();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_ANALYSIS_LIMIT, 60), config.marketData.maxLimit);

    const series = await this.marketData.fetchCandles({
      symbol: input.symbol,
      assetClass: input.assetClass,
      timeframe: input.timeframe,
      limit,
    });

    const { result, warnings: engineWarnings } = await this.executeEngine(series, input);
    const durationMs = Date.now() - startedAt;

    const report = composeReport({ series, result, input, warnings: engineWarnings, durationMs });

    let saved = false;
    if (input.save !== false) {
      await this.history.save(report);
      saved = true;
    }

    log.info('analysis completed', {
      symbol: report.symbol,
      timeframe: report.timeframe,
      status: report.status,
      engine: report.engine.id,
      mode: report.mode,
      durationMs,
    });

    return { report, demo: report.mode === 'demo', saved, durationMs };
  }

  /**
   * Prefer the Python engine. Fall back to the TypeScript reference only when
   * configured to, and never silently: the fallback is recorded in the report
   * and surfaced as a warning.
   */
  private async executeEngine(
    series: CandleSeries,
    input: RunAnalysisInput,
  ): Promise<{ result: EngineRunResult; warnings: string[] }> {
    const warnings: string[] = [];

    try {
      const result = await runPythonEngine({
        symbol: series.symbol,
        timeframe: series.timeframe,
        candles: series.candles,
        options: DEFAULT_ENGINE_OPTIONS,
      });
      return { result, warnings };
    } catch (error) {
      if (!(error instanceof PythonEngineUnavailableError)) throw error;

      log.warn('Python analysis engine unavailable', {
        reason: error.detail.reason,
        detail: error.message,
      });

      if (!config.analysisEngine.allowTypeScriptFallback) {
        return {
          result: {
            engine: { id: 'python', name: 'nexora-analysis-engine', version: 'unavailable' },
            status: 'unavailable',
            requiredCandles: 0,
            receivedCandles: series.candles.length,
            facts: null,
            interpretation: null,
            scenarios: [],
            warnings: [],
            reason:
              'موتور تحلیل پایتون در دسترس نیست و اجرای جایگزین غیرفعال است. ' +
              'برای فعال‌سازی، ANALYSIS_ENGINE_PYTHON را تنظیم کنید یا ' +
              'ANALYSIS_ENGINE_FALLBACK_TS=true را قرار دهید.',
          },
          warnings,
        };
      }

      const fallback = analyzeCandles(series.candles, DEFAULT_ENGINE_OPTIONS, {
        symbol: series.symbol,
        timeframe: series.timeframe,
      });
      fallback.warnings = [
        `امکان اجرای موتور تحلیل پایتون نبود (${error.detail.reason})؛ محاسبات با پیاده‌سازی جایگزین تایپ‌اسکریپت انجام شد.`,
        ...fallback.warnings,
      ];
      return { result: fallback, warnings };
    }
  }
}

function composeReport(args: {
  series: CandleSeries;
  result: EngineRunResult;
  input: RunAnalysisInput;
  warnings: string[];
  durationMs: number;
}): AnalysisReport {
  const { series, result, input, warnings, durationMs } = args;
  const lastCandle = result.facts?.lastCandle ?? series.candles[series.candles.length - 1] ?? null;
  const resolved = resolveSymbol(series.symbol, input.assetClass);

  const combined = [...result.warnings, ...warnings];
  if (result.status !== 'ok' && result.reason) combined.push(result.reason);
  if (series.source.mode === 'demo') {
    combined.push(
      'این تحلیل روی داده‌های دمو (تولیدی و ساختگی) اجرا شده است و هیچ ارتباطی با قیمت واقعی بازار ندارد.',
    );
  }
  if (durationMs > 5_000) {
    combined.push(`زمان اجرای تحلیل طولانی بود (${durationMs} میلی‌ثانیه).`);
  }

  // A report must never claim success without facts to back it up.
  const status = result.status === 'ok' && result.facts ? 'ok' : result.status;

  return {
    id: randomUUID(),
    symbol: series.symbol,
    tvSymbol: series.tvSymbol,
    name: resolved.name,
    assetClass: input.assetClass,
    timeframe: input.timeframe,
    createdAt: new Date().toISOString(),
    dataTimestamp: lastCandle ? new Date(lastCandle.time).toISOString() : null,
    mode: series.source.mode,
    dataSource: series.source.provider,
    engine: result.engine,
    status,
    facts: result.facts,
    interpretation: result.interpretation,
    scenarios: result.scenarios,
    warnings: dedupe(combined),
    disclaimer: ANALYSIS_DISCLAIMER,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))];
}

/** Static description of the engine wiring, used by `/api/health`. */
export function engineInfo(): { id: 'python'; fallback: ReturnType<typeof describeReferenceEngine> } {
  return { id: 'python', fallback: describeReferenceEngine() };
}
