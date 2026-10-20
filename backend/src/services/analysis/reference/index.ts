/**
 * TypeScript reference engine.
 *
 * A faithful port of `analysis-engine/nexora_analysis/engine.py`. It runs only
 * when the Python engine cannot be spawned, and the resulting report always
 * records `engine.id = "typescript-fallback"` plus a warning, so a degraded
 * run can never be mistaken for the primary engine.
 */

import type {
  AnalysisFacts,
  AnalysisInterpretation,
  AnalysisScenario,
  Candle,
  MovingAverageSnapshot,
  SupportResistanceLevel,
} from '../../../types/domain.js';
import { atr, ema, lastValue, macd, percentChange, rsi, sma, stdev } from './indicators.js';
import { detectLevels, findSwings } from './levels.js';
import { detectZones } from './zones.js';
import { analyzeMarketStructure, buildProjection, detectTrendlines } from './structure.js';
import { classifyTrend, regressionLine, type TrendReading } from './trend.js';
import {
  DEFAULT_ENGINE_OPTIONS,
  EngineInputError,
  type EngineOptions,
  type EngineRunResult,
  type EngineSeries,
} from '../types.js';

export const REFERENCE_ENGINE_ID = 'typescript-fallback' as const;

export const REFERENCE_ENGINE_NAME = 'nexora-analysis-reference';
export const REFERENCE_ENGINE_VERSION = '0.3.0';

const MINIMUM_CANDLES = 5;

/**
 * Decimal places for the chart series payload. Kept identical to
 * `SERIES_DECIMALS` / `RSI_DECIMALS` in the Python engine so both engines emit
 * byte-identical series for the same candles.
 */
const SERIES_DECIMALS = 6;
const RSI_DECIMALS = 2;

/**
 * Candle-open-time window, in epoch milliseconds. Identical to the gateway in
 * `src/services/marketData/types.ts` (`sanitizeCandles`) and to
 * `decode_candles` in Python, so a series cannot be interpreted differently on
 * opposite sides of the Node/Python boundary. The window spans 2001-09-09 to
 * ~2286: it accepts every realistic candle while rejecting the same instant
 * expressed in seconds (~1.7e9), microseconds (~1.7e15) or nanoseconds (~1.7e18).
 */
const MIN_EPOCH_MS = 1e12;
const MAX_EPOCH_MS = 1e13;

/**
 * Per-row validity check shared with `sanitizeCandles` and the Python engine.
 * Rows whose high/low do not bracket open/close are *dropped*, not repaired:
 * a real exchange bar cannot have that shape, and silently rewriting it would
 * feed the indicators data that never traded.
 */
function isUsableCandle(candle: {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}): boolean {
  if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
    return false;
  }
  if (candle.time < MIN_EPOCH_MS || candle.time >= MAX_EPOCH_MS) {
    return false;
  }
  if (Math.min(candle.open, candle.high, candle.low, candle.close) <= 0) {
    return false;
  }
  return (
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close
  );
}

/** How the API describes the fallback implementation. */
export function describeReferenceEngine(): { id: 'typescript-fallback'; name: string; version: string } {
  return { id: REFERENCE_ENGINE_ID, name: REFERENCE_ENGINE_NAME, version: REFERENCE_ENGINE_VERSION };
}

export interface DecodedCandles {
  candles: Candle[];
  warnings: string[];
}

/**
 * Validate and normalise raw candles. Malformed *values* are skipped with a
 * warning; a malformed *shape* raises.
 *
 * This is a faithful port of `decode_candles` in
 * `analysis-engine/nexora_analysis/engine.py`, and the row-level rules are the
 * same ones the gateway applies in `src/services/marketData/types.ts`
 * (`sanitizeCandles`): whichever path a series takes, the result is the same.
 */
export function decodeCandles(raw: unknown): DecodedCandles {
  if (!Array.isArray(raw)) {
    throw new EngineInputError('`candles` must be an array of OHLCV objects');
  }

  const usable: Candle[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      skipped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const time = Number(record.time);
    const open = Number(record.open);
    const high = Number(record.high);
    const low = Number(record.low);
    const close = Number(record.close);
    // Volume is lenient, as on the gateway: a missing or unparseable volume is
    // zero rather than a reason to drop an otherwise valid bar.
    const rawVolume = record.volume === undefined || record.volume === null ? 0 : Number(record.volume);
    const volume = Number.isFinite(rawVolume) ? Math.max(rawVolume, 0) : 0;

    if (!isUsableCandle({ time, open, high, low, close })) {
      skipped += 1;
      continue;
    }

    usable.push({ time, open, high, low, close, volume });
  }

  if (skipped > 0) warnings.push(`${skipped} کندل نامعتبر نادیده گرفته شد.`);
  usable.sort((a, b) => a.time - b.time);

  // Collapse duplicate open times, keeping the *first* occurrence (as the
  // gateway does) so every step between consecutive bars is a strictly
  // positive interval for the slope and swing logic.
  const deduped: Candle[] = [];
  for (const candle of usable) {
    if (deduped.length > 0 && (deduped[deduped.length - 1] as Candle).time === candle.time) {
      continue;
    }
    deduped.push(candle);
  }
  if (deduped.length !== usable.length) {
    warnings.push(`${usable.length - deduped.length} کندل با زمان تکراری حذف شد.`);
  }

  return { candles: deduped, warnings };
}

export function requiredCandleCount(options: EngineOptions = DEFAULT_ENGINE_OPTIONS): number {
  const slow = options.macdSlow;
  const signal = options.macdSignal;
  const longestMa = Math.max(...options.smaPeriods, ...options.emaPeriods, slow);
  return Math.max(slow + signal, longestMa) + 5;
}

function rsiState(value: number | null): { state: string; signal: 'bullish' | 'bearish' | 'neutral' } {
  if (value === null) return { state: 'unknown', signal: 'neutral' };
  if (value >= 70) return { state: 'overbought', signal: 'bearish' };
  if (value <= 30) return { state: 'oversold', signal: 'bullish' };
  if (value >= 55) return { state: 'bullish_bias', signal: 'bullish' };
  if (value <= 45) return { state: 'bearish_bias', signal: 'bearish' };
  return { state: 'neutral', signal: 'neutral' };
}

function macdState(
  histogram: number | null,
  previous: number | null,
): { state: string; direction: 'bullish' | 'bearish' | 'neutral' } {
  if (histogram === null) return { state: 'unknown', direction: 'neutral' };
  if (previous !== null) {
    if (histogram > 0 && histogram > previous) return { state: 'bullish_rising', direction: 'bullish' };
    if (histogram > 0 && histogram <= previous) return { state: 'bullish_fading', direction: 'neutral' };
    if (histogram < 0 && histogram < previous) return { state: 'bearish_widening', direction: 'bearish' };
    if (histogram < 0 && histogram >= previous) return { state: 'bearish_fading', direction: 'neutral' };
  }
  if (histogram > 0) return { state: 'bullish', direction: 'bullish' };
  if (histogram < 0) return { state: 'bearish', direction: 'bearish' };
  return { state: 'neutral', direction: 'neutral' };
}

function maSnapshots(
  closes: number[],
  periods: number[],
  method: 'sma' | 'ema',
): MovingAverageSnapshot[] {
  const lastClose = closes[closes.length - 1] as number;
  return periods.map((period) => {
    const series = method === 'sma' ? sma(closes, period) : ema(closes, period);
    const value = lastValue(series);
    if (value === null) {
      return { period, value: null, state: 'warming_up', signal: 'neutral' as const };
    }
    const distance = value === 0 ? 0 : ((lastClose - value) / value) * 100;
    return {
      period,
      value,
      state: distance > 0 ? 'above' : distance < 0 ? 'below' : 'at',
      signal: distance > 0 ? ('bullish' as const) : distance < 0 ? ('bearish' as const) : ('neutral' as const),
    };
  });
}

function buildFacts(candles: Candle[], options: EngineOptions, timeframe: string): AnalysisFacts {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);

  const rsiValues = rsi(closes, options.rsiPeriod);
  const latestRsi = lastValue(rsiValues);

  const macdSeries = macd(closes, options.macdFast, options.macdSlow, options.macdSignal);
  const latestMacd = lastValue(macdSeries.macd);
  const latestSignal = lastValue(macdSeries.signal);
  const latestHistogram = lastValue(macdSeries.histogram);
  const previousHistogram = lastValue(macdSeries.histogram.slice(0, -1));
  const macdReading = macdState(latestHistogram, previousHistogram);

  const latestAtr = lastValue(atr(highs, lows, closes, options.atrPeriod));

  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1] as number;
    if (previous !== 0) returns.push(((closes[index] as number) - previous) / previous);
  }
  const volatility = stdev(returns);

  const change = percentChange(closes[0] as number, closes[closes.length - 1] as number);
  const trend = classifyTrend(highs, lows, closes, options.swingLookback);
  const levels = detectLevels(highs, lows, closes, options.swingLookback, options.maxLevels, candles.map((candle) => candle.time));
  const zones = detectZones(candles, timeframe, options.swingLookback, Math.max(4, options.maxLevels) + 1);
  const structure = analyzeMarketStructure(candles, options.swingLookback);
  const trendlines = detectTrendlines(candles, options.swingLookback);

  const round = (value: number, decimals: number): number =>
    Number(value.toFixed(decimals));

  return {
    lastCandle: candles[candles.length - 1] ?? null,
    candleCount: candles.length,
    changePercent: change === null ? null : round(change, 4),
    volatilityPercent: volatility === null ? null : round(volatility * 100, 4),
    indicators: {
      rsi:
        latestRsi === null
          ? null
          : { value: round(latestRsi, 2), ...rsiState(latestRsi) },
      macd:
        latestMacd === null
          ? null
          : {
              macd: latestMacd === null ? null : round(latestMacd, 6),
              signal: latestSignal === null ? null : round(latestSignal, 6),
              histogram: latestHistogram === null ? null : round(latestHistogram, 6),
              state: macdReading.state,
              signalDirection: macdReading.direction,
            },
      sma: maSnapshots(closes, options.smaPeriods, 'sma'),
      ema: maSnapshots(closes, options.emaPeriods, 'ema'),
      atr:
        latestAtr === null
          ? null
          : { value: round(latestAtr, 6), state: 'volatility', signal: 'neutral' },
    },
    trend: {
      direction: trend.direction,
      strength: trend.strength,
      evidence: trend.evidence,
      higherHighs: trend.higherHighs,
      higherLows: trend.higherLows,
    },
    levels: levels
      ? {
          supports: levels.supports,
          resistances: levels.resistances,
          nearestSupport: levels.nearestSupport,
          nearestResistance: levels.nearestResistance,
        }
      : null,
    zones,
    structure,
    trendlines,
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Round an aligned indicator series, preserving its `null` warm-up gaps. */
function rounded(values: Array<number | null>, decimals = SERIES_DECIMALS): Array<number | null> {
  return values.map((value) => (value === null ? null : roundTo(value, decimals)));
}

/**
 * Every indicator value for every bar, aligned to the candle index.
 *
 * Mirror of `_build_series` in the Python engine: same arrays, same alignment
 * and the same rounding, so a chart looks identical whichever engine ran. See
 * `EngineSeries` for the contract.
 */
function buildSeries(candles: Candle[], options: EngineOptions): EngineSeries {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);

  const macdSeries = macd(closes, options.macdFast, options.macdSlow, options.macdSignal);
  const { swingHighs, swingLows } = findSwings(highs, lows, options.swingLookback);
  const regression = regressionLine(closes);

  const smaSeries: Record<string, Array<number | null>> = {};
  for (const period of options.smaPeriods) {
    smaSeries[String(period)] = rounded(sma(closes, period));
  }
  const emaSeries: Record<string, Array<number | null>> = {};
  for (const period of options.emaPeriods) {
    emaSeries[String(period)] = rounded(ema(closes, period));
  }

  return {
    count: candles.length,
    sma: smaSeries,
    ema: emaSeries,
    rsi: rounded(rsi(closes, options.rsiPeriod), RSI_DECIMALS),
    macd: {
      macd: rounded(macdSeries.macd),
      signal: rounded(macdSeries.signal),
      histogram: rounded(macdSeries.histogram),
    },
    atr: rounded(atr(highs, lows, closes, options.atrPeriod)),
    swings: {
      highs: swingHighs.map((point) => ({
        index: point.index,
        price: roundTo(point.price, SERIES_DECIMALS),
      })),
      lows: swingLows.map((point) => ({
        index: point.index,
        price: roundTo(point.price, SERIES_DECIMALS),
      })),
    },
    regression:
      regression === null
        ? null
        : {
            slope: roundTo(regression.slope, 10),
            intercept: roundTo(regression.intercept, 10),
            window: regression.window,
            startIndex: regression.startIndex,
          },
  };
}

const TREND_LABELS: Record<string, string> = {
  uptrend: 'صعودی',
  downtrend: 'نزولی',
  sideways: 'بدون روند مشخص (رِنج)',
  unknown: 'نامشخص',
};

function buildInterpretation(
  facts: AnalysisFacts,
  symbol: string,
  timeframe: string,
  slopePercent: number | null,
): AnalysisInterpretation {
  const indicators = facts.indicators;
  const trend = facts.trend;
  const direction = trend?.direction ?? 'unknown';
  const strength = trend?.strength ?? null;

  const rsiValue = indicators.rsi?.value ?? null;
  const histogram = indicators.macd?.histogram ?? null;
  const nearestSupport = facts.levels?.nearestSupport ?? null;
  const nearestResistance = facts.levels?.nearestResistance ?? null;

  const summaryParts = [
    `در تایم‌فریم ${timeframe}، روند فعلی ${symbol} «${TREND_LABELS[direction] ?? 'نامشخص'}» خوانده می‌شود` +
      (typeof strength === 'number' ? ` با قدرت تقریبی ${strength} از ۱۰۰.` : '.'),
  ];
  if (rsiValue !== null) summaryParts.push(`RSI روی ${rsiValue} است.`);
  if (histogram !== null) {
    summaryParts.push(
      'هیستوگرام MACD ' +
        (histogram > 0 ? 'مثبت است.' : histogram < 0 ? 'منفی است.' : 'صفر است.'),
    );
  }
  if (nearestSupport && nearestResistance) {
    summaryParts.push(
      `نزدیک‌ترین حمایت در ${nearestSupport.price} و نزدیک‌ترین مقاومت در ${nearestResistance.price} قرار دارد.`,
    );
  }

  const trendReading =
    (slopePercent !== null ? `شیب اندازه‌گیری‌شده ${slopePercent} درصد در هر کندل است. ` : '') +
    (trend?.higherHighs && direction === 'uptrend'
      ? 'ساختار سقف‌ها و کف‌ها از ادامه روند حمایت می‌کند.'
      : direction === 'uptrend' || direction === 'downtrend'
        ? 'ساختار سقف‌ها و کف‌ها از ادامه روند حمایت نمی‌کند.'
        : 'قیمت در محدوده‌ای بدون جهت غالب نوسان می‌کند.');

  let momentumReading: string;
  if (rsiValue === null) {
    momentumReading = 'برای محاسبه مومنتوم داده کافی وجود نداشت.';
  } else if (rsiValue >= 70) {
    momentumReading = 'RSI در ناحیه اشباع خرید است؛ ادامه حرکت نیازمند تایید حجم و ساختار قیمتی است.';
  } else if (rsiValue <= 30) {
    momentumReading = 'RSI در ناحیه اشباع فروش است؛ احتمال بازگشت کوتاه‌مدت وجود دارد اما تضمینی نیست.';
  } else {
    momentumReading = 'RSI در ناحیه میانی است و مومنتوم قاطعانه‌ای نشان نمی‌دهد.';
  }

  const volatility = facts.volatilityPercent;
  const candleCount = facts.candleCount;
  let volatilityReading: string;
  if (volatility === null) {
    volatilityReading = 'نوسان قابل اندازه‌گیری نبود.';
  } else if (volatility > 3) {
    volatilityReading =
      `نوسان بازده‌ها (انحراف معیار ساده روی کل ${candleCount} کندل) برابر ${volatility} درصد است؛ ` +
      'در چنین شرایطی حد ضرر باید بازتر و حجم کوچک‌تر باشد.';
  } else if (volatility < 0.8) {
    volatilityReading =
      `نوسان بازده‌ها (انحراف معیار ساده روی کل ${candleCount} کندل) برابر ${volatility} درصد است؛ ` +
      'بازار کم‌نوسان است.';
  } else {
    volatilityReading =
      `نوسان بازده‌ها (انحراف معیار ساده روی کل ${candleCount} کندل) برابر ${volatility} درصد در ` +
      'محدوده متعارف این تایم‌فریم است.';
  }

  const caveats = [
    'تمام اعداد این بخش از کندل‌های ورودی محاسبه شده‌اند و به کیفیت همان داده وابسته‌اند.',
    'هیچ‌کدام از این خوانش‌ها قطعی نیستند و می‌توانند با یک کندل جدید بی‌اعتبار شوند.',
    'این تحلیل جایگزین مدیریت ریسک، حجم معاملاتی و بررسی اخبار بنیادی نیست.',
  ];
  if (facts.candleCount < 200) {
    caveats.push(
      `تنها ${facts.candleCount} کندل در دسترس بود؛ اندیکاتورهای بلندمدت مانند SMA200 معنای محدودی دارند.`,
    );
  }

  return { summary: summaryParts.join(' '), trendReading, momentumReading, volatilityReading, caveats };
}

function buildScenarios(facts: AnalysisFacts): AnalysisScenario[] {
  const nearestSupport: SupportResistanceLevel | null = facts.levels?.nearestSupport ?? null;
  const nearestResistance: SupportResistanceLevel | null = facts.levels?.nearestResistance ?? null;
  const direction = facts.trend?.direction ?? 'unknown';
  const strength = facts.trend?.strength ?? 0;

  const confidence: AnalysisScenario['confidence'] =
    strength >= 60 ? 'high' : strength >= 30 ? 'medium' : 'low';

  const scenarios: AnalysisScenario[] = [];

  if (nearestResistance) {
    scenarios.push({
      id: 'breakout-up',
      title: 'شکست مقاومت نزدیک',
      bias: 'bullish',
      condition: `بسته‌شدن یک کندل بالای ${nearestResistance.price} با حجم بالاتر از میانگین شرط اولیه این سناریو است.`,
      invalidation: `بازگشت قیمت به زیر ${nearestResistance.price} و تثبیت زیر آن، این سناریو را بی‌اعتبار می‌کند.`,
      confidence,
    });
  }

  if (nearestSupport) {
    scenarios.push({
      id: 'breakdown-down',
      title: 'شکست حمایت نزدیک',
      bias: 'bearish',
      condition: `بسته‌شدن یک کندل زیر ${nearestSupport.price} سناریوی ادامه نزول را فعال می‌کند.`,
      invalidation: `بازگشت و تثبیت قیمت بالای ${nearestSupport.price} این سناریو را بی‌اعتبار می‌کند.`,
      confidence,
    });
  }

  if (direction === 'sideways') {
    scenarios.push({
      id: 'range-play',
      title: 'نوسان در محدوده',
      bias: 'neutral',
      condition:
        'تا زمانی که قیمت بین حمایت و مقاومت نزدیک نوسان می‌کند، حرکت جهت‌دار کم‌احتمال است.',
      invalidation: 'خروج قیمت از محدوده با بسته‌شدن کندل خارج از آن، این خوانش را باطل می‌کند.',
      confidence: 'medium',
    });
  }

  if (scenarios.length === 0) {
    scenarios.push({
      id: 'insufficient-levels',
      title: 'سطوح کافی شناسایی نشد',
      bias: 'neutral',
      condition: 'برای ساخت سناریوی شرطی، حداقل یک سطح حمایت یا مقاومت معتبر لازم است.',
      invalidation: 'با افزایش تعداد کندل‌ها این بخش بازمحاسبه می‌شود.',
      confidence: 'low',
    });
  }

  return scenarios;
}

/** Run the full reference pipeline. */
export function analyzeCandles(
  rawCandles: unknown,
  options: EngineOptions = DEFAULT_ENGINE_OPTIONS,
  context: { symbol?: string; timeframe?: string } = {},
): EngineRunResult {
  const { candles, warnings } = decodeCandles(rawCandles);
  const required = requiredCandleCount(options);

  const base = {
    engine: describeReferenceEngine(),
    requiredCandles: required,
    receivedCandles: candles.length,
    warnings: [...warnings],
  };

  if (candles.length < MINIMUM_CANDLES) {
    return {
      ...base,
      status: 'unavailable',
      facts: null,
      interpretation: null,
      scenarios: [],
      projection: null,
      series: null,
      reason:
        `برای تحلیل حداقل ${MINIMUM_CANDLES} کندل معتبر لازم است اما فقط ` +
        `${candles.length} کندل قابل استفاده دریافت شد.`,
    };
  }

  if (candles.length < required) {
    return {
      ...base,
      status: 'insufficient_data',
      facts: null,
      interpretation: null,
      scenarios: [],
      projection: null,
      series: null,
      reason:
        `این مجموعه اندیکاتورها به ${required} کندل نیاز دارد اما فقط ${candles.length} کندل دریافت شد. ` +
        'نتیجه‌ای تولید نشد.',
    };
  }

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const trend: TrendReading = classifyTrend(highs, lows, closes, options.swingLookback);
  const facts = buildFacts(candles, options, context.timeframe ?? '1h');
  const projection = buildProjection(
    candles,
    context.timeframe ?? '1h',
    facts.structure ?? null,
    facts.zones ?? null,
    facts.trendlines ?? [],
  );

  return {
    ...base,
    status: 'ok',
    facts,
    projection,
    interpretation: buildInterpretation(
      facts,
      context.symbol ?? 'unknown',
      context.timeframe ?? 'unknown',
      trend.slopePercentPerCandle,
    ),
    scenarios: buildScenarios(facts),
    series: options.includeSeries ? buildSeries(candles, options) : null,
    reason: null,
  };
}
