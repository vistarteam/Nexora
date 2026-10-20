import { randomUUID } from 'node:crypto';
import { config } from '../../config/env.js';
import { createLogger } from '../../lib/logger.js';
import {
  ANALYSIS_DISCLAIMER,
  type AnalysisReport,
  type AssetClass,
  type CandleSeries,
  type ChartPayload,
  type Timeframe,
} from '../../types/domain.js';
import { resolveSymbol, type MarketDataService } from '../marketData/index.js';
import type { HistoryService } from '../historyService.js';
import { buildChartPayload } from './chartPayload.js';
import { analyzeCandles, describeReferenceEngine } from './reference/index.js';
import { PythonEngineUnavailableError, runPythonEngine } from './pythonEngine.js';
import { DEFAULT_ENGINE_OPTIONS, type EngineOptions, type EngineRunResult } from './types.js';

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
  /**
   * Also return the chart payload computed from the very same candles.
   *
   * Requested by the UI instead of a second data call on purpose: when the chart
   * comes from the same run as the report, its newest bar, its indicators and its
   * levels are identical to the ones the report describes. Two separate fetches
   * could drift apart by one forming candle, which is exactly the kind of
   * mismatch that made the previous chart untrustworthy.
   */
  includeChart?: boolean;
}

/** Input for a chart-only request (no report is composed or persisted). */
export interface ChartInput {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  limit?: number;
}

export interface RunAnalysisOutput {
  report: AnalysisReport;
  /** Present only when the caller asked for it. */
  chart: ChartPayload | null;
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
 * Every report records the venue that supplied its candles (`dataSource`) and
 * the data mode, so a reading is never separated from its provenance.
 */
export class AnalysisService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly history: HistoryService,
  ) {}

  async run(input: RunAnalysisInput): Promise<RunAnalysisOutput> {
    const startedAt = Date.now();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_ANALYSIS_LIMIT, 60), config.marketData.maxLimit);
    const includeChart = input.includeChart === true;

    const series = await this.marketData.fetchCandles({
      symbol: input.symbol,
      assetClass: input.assetClass,
      timeframe: input.timeframe,
      limit,
    });

    const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, includeSeries: includeChart };
    const { result, warnings: engineWarnings } = await this.executeEngine(series, input, options);
    const durationMs = Date.now() - startedAt;

    const report = composeReport({ series, result, warnings: engineWarnings, durationMs });

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
      chart: includeChart,
    });      return {
        report,
        chart: includeChart ? this.buildChart(series, result) : null,
        saved,
        durationMs,
      };
  }

  /**
   * Chart payload without a report.
   *
   * Same pipeline, same engine, same candles as `run()`; it simply skips report
   * composition and persistence. This is what the market view uses, so the chart
   * there is drawn from real provider candles and real engine output rather than
   * from a third-party widget the engine knows nothing about.
   */
  async chart(input: ChartInput): Promise<ChartPayload> {
    const startedAt = Date.now();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_ANALYSIS_LIMIT, 60), config.marketData.maxLimit);
    const options: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, includeSeries: true };

    const series = await this.marketData.fetchCandles({
      symbol: input.symbol,
      assetClass: input.assetClass,
      timeframe: input.timeframe,
      limit,
    });

    const { result } = await this.executeEngine(series, input, options);
    const payload = this.buildChart(series, result);

    log.info('chart computed', {
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      status: payload.status,
      engine: payload.engine.id,
      candles: payload.candles.length,
      durationMs: Date.now() - startedAt,
    });

    return payload;
  }

  private buildChart(series: CandleSeries, result: EngineRunResult): ChartPayload {
    return buildChartPayload({
      series,
      result,
      options: DEFAULT_ENGINE_OPTIONS,
      // `series.assetClass` is the class the market-data layer actually routed
      // on (the catalog's, for a listed symbol), so the label matches the venue
      // that answered rather than what the request happened to claim.
      name: resolveSymbol(series.symbol, series.assetClass).name,
    });
  }

  /**
   * Prefer the Python engine. Fall back to the TypeScript reference only when
   * configured to, and never silently: the fallback is recorded in the report
   * and surfaced as a warning.
   */
  private async executeEngine(
    series: CandleSeries,
    input: { symbol: string; assetClass: AssetClass; timeframe: Timeframe },
    options: EngineOptions,
  ): Promise<{ result: EngineRunResult; warnings: string[] }> {
    const warnings: string[] = [];

    try {
      const result = await runPythonEngine({
        symbol: series.symbol,
        timeframe: series.timeframe,
        candles: series.candles,
        options,
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
            series: null,
            warnings: [],
            reason:
              'موتور تحلیل پایتون در دسترس نیست و اجرای جایگزین غیرفعال است. ' +
              'برای فعال‌سازی، ANALYSIS_ENGINE_PYTHON را تنظیم کنید یا ' +
              'ANALYSIS_ENGINE_FALLBACK_TS=true را قرار دهید.',
          },
          warnings,
        };
      }

      const fallback = analyzeCandles(series.candles, options, {
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
  warnings: string[];
  durationMs: number;
}): AnalysisReport {
  const { series, result, warnings, durationMs } = args;
  const lastCandle = result.facts?.lastCandle ?? series.candles[series.candles.length - 1] ?? null;
  const resolved = resolveSymbol(series.symbol, series.assetClass);

  const combined = [...result.warnings, ...warnings];
  if (result.status !== 'ok' && result.reason) combined.push(result.reason);
  if (series.lastCandleStatus === 'forming') {
    combined.push(
      'جدیدترین کندل هنوز در حال تشکیل است و مقدار نهایی آن قطعی نیست؛ بخش انتهایی محاسبات می‌تواند با بسته‌شدن این کندل تغییر کند.',
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
    assetClass: series.assetClass,
    timeframe: series.timeframe,
    createdAt: new Date().toISOString(),
    dataTimestamp: lastCandle ? new Date(lastCandle.time).toISOString() : null,
    mode: series.source.mode,
    dataSource: series.source.provider,
    engine: result.engine,
    status,
    facts: result.facts,
    interpretation: result.interpretation,
    scenarios: result.scenarios,
    projection: result.projection ?? null,
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
