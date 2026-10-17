/**
 * Chart payload composition.
 *
 * Turns one engine run into everything a price chart needs to draw *that same
 * analysis*: the candles the engine analysed, the moving averages and
 * oscillators it computed, the support/resistance levels it detected, the swing
 * points it found and the trend line it fitted.
 *
 * Nothing here recomputes an indicator and nothing invents a number: every value
 * comes from the engine result. That is the whole point — the previous UI drew a
 * third-party widget whose venue, interval and candle count had nothing to do
 * with the candles the report was based on, so the chart and the analysis could
 * (and did) disagree. A payload built this way cannot.
 *
 * Index-aligned engine arrays are converted into `{ time, value }` points here,
 * because the time axis belongs to the candle series, not to the indicators.
 */

import type {
  CandleSeries,
  ChartOverlay,
  ChartPayload,
  ChartPoint,
} from '../../types/domain.js';
import type { EngineOptions, EngineRunResult, EngineSeries } from './types.js';

/** Conventional RSI bounds, matching `_rsi_state` in the engine. */
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

export interface BuildChartPayloadArgs {
  /** The exact candle series handed to the engine. */
  series: CandleSeries;
  /** The engine result computed from that same series. */
  result: EngineRunResult;
  /** The options the engine ran with — the periods the labels must state. */
  options: EngineOptions;
  /** Persian display name for the instrument. */
  name: string;
}

/**
 * Zip an index-aligned engine array with candle open times.
 *
 * Warm-up entries (`null`) and non-finite values are skipped rather than
 * plotted as gaps' neighbours, so a curve starts exactly where the indicator
 * becomes defined.
 */
function toPoints(times: number[], values: Array<number | null> | undefined): ChartPoint[] {
  if (!values) return [];
  const points: ChartPoint[] = [];
  const length = Math.min(times.length, values.length);
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    points.push({ time: times[index] as number, value });
  }
  return points;
}

function buildOverlays(series: EngineSeries, times: number[]): ChartOverlay[] {
  const overlays: ChartOverlay[] = [];

  for (const [period, values] of Object.entries(series.sma ?? {})) {
    overlays.push({ id: `sma${period}`, kind: 'sma', period: Number(period), points: toPoints(times, values) });
  }
  for (const [period, values] of Object.entries(series.ema ?? {})) {
    overlays.push({ id: `ema${period}`, kind: 'ema', period: Number(period), points: toPoints(times, values) });
  }

  // Shortest periods first: they hug the price, so they are drawn on top.
  return overlays.sort((a, b) => a.period - b.period);
}

function buildSwings(
  series: EngineSeries,
  candles: CandleSeries['candles'],
): { highs: ChartPoint[]; lows: ChartPoint[] } | null {
  const swingPoints = series.swings;
  if (!swingPoints) return null;

  const map = (points: { index: number; price: number }[]): ChartPoint[] =>
    points
      .filter((point) => point.index >= 0 && point.index < candles.length)
      .map((point) => ({
        time: (candles[point.index] as { time: number }).time,
        value: point.price,
      }));

  const highs = map(swingPoints.highs ?? []);
  const lows = map(swingPoints.lows ?? []);
  if (highs.length === 0 && lows.length === 0) return null;
  return { highs, lows };
}

/**
 * Both endpoints of the fitted trend line, expressed in the candle time axis.
 *
 * The engine reports the fit indexed from the start of its own window, so the
 * endpoints are `startIndex` and the newest bar, not the whole series.
 */
function buildRegression(
  series: EngineSeries,
  candles: CandleSeries['candles'],
): { from: ChartPoint; to: ChartPoint } | null {
  const regression = series.regression;
  if (!regression || candles.length === 0) return null;

  const { slope, intercept, window, startIndex } = regression;
  if (window < 3 || startIndex < 0 || startIndex + window > candles.length) return null;

  const from = candles[startIndex];
  const to = candles[startIndex + window - 1];
  if (!from || !to) return null;

  const fromPrice = intercept;
  const toPrice = intercept + slope * (window - 1);
  if (!Number.isFinite(fromPrice) || !Number.isFinite(toPrice)) return null;

  return {
    from: { time: from.time, value: fromPrice },
    to: { time: to.time, value: toPrice },
  };
}

/**
 * Build the payload for one analysis run.
 *
 * Returns candles even when the engine produced no series (`insufficient_data`):
 * a chart with no overlays plus the engine's own explanation is honest and
 * useful, whereas an empty screen tells the user nothing.
 */
export function buildChartPayload(args: BuildChartPayloadArgs): ChartPayload {
  const { series: candleSeries, result, options, name } = args;
  const candles = candleSeries.candles;
  const times = candles.map((candle) => candle.time);
  const engineSeries = result.status === 'ok' ? result.series : null;
  const facts = result.facts;

  const warnings = [...result.warnings];
  if (result.status !== 'ok' && result.reason) warnings.push(result.reason);
  if (candleSeries.lastCandleStatus === 'forming') {
    warnings.push(
      'جدیدترین کندل هنوز در حال تشکیل است؛ اندیکاتورها و سطوح انتهایی می‌توانند با بسته‌شدن این کندل تغییر کنند.',
    );
  }

  const macd = engineSeries?.macd;

  return {
    symbol: candleSeries.symbol,
    tvSymbol: candleSeries.tvSymbol,
    name,
    assetClass: candleSeries.assetClass,
    timeframe: candleSeries.timeframe,
    generatedAt: candleSeries.source.fetchedAt,
    mode: candleSeries.source.mode,
    dataSource: candleSeries.source.provider,
    ...(candleSeries.lastCandleStatus ? { lastCandleStatus: candleSeries.lastCandleStatus } : {}),
    engine: result.engine,
    status: result.status,
    reason: result.reason,
    warnings: [...new Set(warnings.filter((warning) => warning.trim() !== ''))],
    candles,
    overlays: engineSeries ? buildOverlays(engineSeries, times) : [],
    indicators: {
      rsi:
        engineSeries && engineSeries.rsi
          ? {
              period: options.rsiPeriod,
              overbought: RSI_OVERBOUGHT,
              oversold: RSI_OVERSOLD,
              points: toPoints(times, engineSeries.rsi),
            }
          : null,
      macd:
        engineSeries && macd
          ? {
              fast: options.macdFast,
              slow: options.macdSlow,
              signalPeriod: options.macdSignal,
              macd: toPoints(times, macd.macd),
              signal: toPoints(times, macd.signal),
              histogram: toPoints(times, macd.histogram),
            }
          : null,
      atr: engineSeries
        ? { period: options.atrPeriod, points: toPoints(times, engineSeries.atr) }
        : null,
    },
    levels: facts?.levels
      ? {
          supports: facts.levels.supports,
          resistances: facts.levels.resistances,
          nearestSupport: facts.levels.nearestSupport,
          nearestResistance: facts.levels.nearestResistance,
        }
      : null,
    swings: engineSeries ? buildSwings(engineSeries, candles) : null,
    trend: facts?.trend
      ? {
          direction: facts.trend.direction,
          strength: facts.trend.strength,
          regression: engineSeries ? buildRegression(engineSeries, candles) : null,
        }
      : null,
  };
}
