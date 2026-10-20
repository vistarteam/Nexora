/**
 * Market structure, trend lines and conditional projections — TypeScript
 * reference implementation.
 *
 * Mirrors `analysis-engine/nexora_analysis/structure.py`. Swing pivots are only
 * available after their confirmation window, breaks require a candle close
 * beyond the level plus an ATR buffer, and the projection is explicitly
 * experimental and probability-free.
 */

import type {
  Candle,
  ChartPoint,
  ConfirmedSwing,
  MarketProjection,
  MarketStructure,
  ProjectionScenario,
  StructureEvent,
  TrendLine,
  ZoneSet,
} from '../../../types/domain.js';
import { atr } from './indicators.js';

export const PROJECTION_VERSION = 'projection-0.1-experimental';
const BREAK_BUFFER_ATR = 0.15;
const TRENDLINE_TOLERANCE_ATR = 0.35;
const TRENDLINE_MAX_STEEPNESS = 0.35;

const TIMEFRAME_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

interface RawSwing {
  index: number;
  price: number;
  time: number;
  confirmedAtTime: number;
  rejection: number;
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

function referenceAtr(candles: Candle[]): number | null {
  const values = atr(
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    candles.map((candle) => candle.close),
    14,
  );
  const usable = values
    .slice(-120)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (usable.length > 0) return median(usable);
  return median(candles.map((candle) => candle.high - candle.low).filter((value) => value > 0));
}

function confirmedSwings(candles: Candle[], lookback: number): { highs: RawSwing[]; lows: RawSwing[] } {
  const highs: RawSwing[] = [];
  const lows: RawSwing[] = [];

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index] as Candle;
    const confirmedAtTime = (candles[index + lookback] as Candle).time;
    const highWindow = candles.slice(index - lookback, index + lookback + 1).map((item) => item.high);
    const lowWindow = candles.slice(index - lookback, index + lookback + 1).map((item) => item.low);
    const range = candle.high - candle.low;

    if (candle.high === Math.max(...highWindow) && highWindow.filter((value) => value === candle.high).length === 1) {
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      highs.push({
        index,
        price: candle.high,
        time: candle.time,
        confirmedAtTime,
        rejection: range > 0 ? Math.max(0, Math.min(1, upperWick / range)) : 0,
      });
    }
    if (candle.low === Math.min(...lowWindow) && lowWindow.filter((value) => value === candle.low).length === 1) {
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      lows.push({
        index,
        price: candle.low,
        time: candle.time,
        confirmedAtTime,
        rejection: range > 0 ? Math.max(0, Math.min(1, lowerWick / range)) : 0,
      });
    }
  }

  return { highs, lows };
}

function structureDirection(highs: RawSwing[], lows: RawSwing[]): MarketStructure['direction'] {
  if (highs.length < 2 || lows.length < 2) return 'unknown';
  const lastHighs = highs.slice(-3).map((point) => point.price);
  const lastLows = lows.slice(-3).map((point) => point.price);
  const higherHighs = lastHighs.every((value, index) => index === 0 || value > (lastHighs[index - 1] as number));
  const higherLows = lastLows.every((value, index) => index === 0 || value > (lastLows[index - 1] as number));
  const lowerHighs = lastHighs.every((value, index) => index === 0 || value < (lastHighs[index - 1] as number));
  const lowerLows = lastLows.every((value, index) => index === 0 || value < (lastLows[index - 1] as number));
  if (higherHighs && higherLows) return 'bullish';
  if (lowerHighs && lowerLows) return 'bearish';
  return 'ranging';
}

function toPublicSwing(swing: RawSwing): ConfirmedSwing {
  return {
    time: swing.time,
    price: round(swing.price),
    index: swing.index,
    confirmedAtTime: swing.confirmedAtTime,
    rejection: round(swing.rejection, 4),
  };
}

/** Confirmed structure and BOS/CHoCH events. */
export function analyzeMarketStructure(candles: Candle[], swingLookback = 5): MarketStructure {
  if (candles.length < swingLookback * 2 + 3) {
    return {
      direction: 'unknown',
      swings: { highs: [], lows: [] },
      events: [],
      lastEvent: null,
      rules: { confirmationBars: swingLookback, breakBufferAtr: BREAK_BUFFER_ATR },
      evidence: ['داده کافی برای ساختار بازار وجود ندارد.'],
      warnings: ['ساختار بازار بدون تعداد کافی کندل قابل تشخیص نیست.'],
    };
  }

  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const closes = candles.map((candle) => candle.close);
  const atrRef = referenceAtr(candles) ?? Math.max((closes[closes.length - 1] as number) * 0.002, 1e-9);
  const swings = confirmedSwings(candles, swingLookback);
  let direction = structureDirection(swings.highs, swings.lows);

  const events: StructureEvent[] = [];
  let lastDirection: 'bullish' | 'bearish' | null = null;

  for (const swing of [...swings.highs].sort((a, b) => a.index - b.index)) {
    const confirmedIndex = swing.index + swingLookback;
    for (let index = confirmedIndex; index < candles.length; index += 1) {
      const close = closes[index] as number;
      if (close <= swing.price + atrRef * BREAK_BUFFER_ATR) continue;
      events.push({
        type: lastDirection === null || lastDirection === 'bullish' ? 'bos' : 'choch',
        direction: 'bullish',
        level: round(swing.price),
        close: round(close),
        time: (candles[index] as Candle).time,
        atrMultiple: round((close - swing.price) / atrRef, 3),
      });
      lastDirection = 'bullish';
      break;
    }
  }

  for (const swing of [...swings.lows].sort((a, b) => a.index - b.index)) {
    const confirmedIndex = swing.index + swingLookback;
    for (let index = confirmedIndex; index < candles.length; index += 1) {
      const close = closes[index] as number;
      if (close >= swing.price - atrRef * BREAK_BUFFER_ATR) continue;
      events.push({
        type: lastDirection === null || lastDirection === 'bearish' ? 'bos' : 'choch',
        direction: 'bearish',
        level: round(swing.price),
        close: round(close),
        time: (candles[index] as Candle).time,
        atrMultiple: round((swing.price - close) / atrRef, 3),
      });
      lastDirection = 'bearish';
      break;
    }
  }

  events.sort((a, b) => a.time - b.time);
  const trimmed = events.slice(-6);
  const lastEvent = trimmed[trimmed.length - 1] ?? null;
  if (lastEvent) direction = lastEvent.direction;

  const evidence = [
    `ساختار از سوئینگ‌های تأییدشده با پنجره ${swingLookback} کندل ساخته شده است.`,
    `آستانه شکست ${BREAK_BUFFER_ATR} برابر ATR و بر اساس بسته‌شدن کندل است.`,
  ];
  if (lastEvent) {
    evidence.push(
      `آخرین رخداد ${lastEvent.type === 'bos' ? 'BOS' : 'CHoCH'} ${lastEvent.direction} ` +
        `در سطح ${lastEvent.level} با بسته‌شدن ${lastEvent.close} ثبت شده است.`,
    );
  } else {
    evidence.push('هیچ شکست ساختاری با آستانه فعلی ثبت نشده است.');
  }

  const warnings: string[] = [];
  if (trimmed.length >= 2) {
    const lastTwo = trimmed.slice(-2);
    if (lastTwo[0]?.direction !== lastTwo[1]?.direction) {
      warnings.push('آخرین دو رخداد ساختاری خلاف جهت هم هستند؛ بازار در حال گذار است.');
    }
  }
  if (direction === 'ranging') warnings.push('ساختار جهت غالب ندارد؛ رخدادهای شکست را با احتیاط بخوانید.');

  return {
    direction,
    swings: { highs: swings.highs.map(toPublicSwing), lows: swings.lows.map(toPublicSwing) },
    events: trimmed,
    lastEvent,
    rules: { confirmationBars: swingLookback, breakBufferAtr: BREAK_BUFFER_ATR },
    evidence,
    warnings,
  };
}

function lineValue(anchor: RawSwing, slope: number, index: number): number {
  return anchor.price + slope * (index - anchor.index);
}

/** Candidate rising support / falling resistance lines from confirmed swings. */
export function detectTrendlines(candles: Candle[], swingLookback = 5, maxLines = 4): TrendLine[] {
  if (candles.length < swingLookback * 2 + 5) return [];
  const closes = candles.map((candle) => candle.close);
  const atrRef = referenceAtr(candles) ?? Math.max((closes[closes.length - 1] as number) * 0.002, 1e-9);
  const tolerance = atrRef * TRENDLINE_TOLERANCE_ATR;
  const swings = confirmedSwings(candles, swingLookback);
  const lastIndex = candles.length - 1;
  const lastTime = (candles[lastIndex] as Candle).time;
  const referencePrice = closes[lastIndex] as number;

  interface Candidate {
    kind: TrendLine['kind'];
    slope: number;
    rSquared: number | null;
    touches: RawSwing[];
    endPrice: number;
    steepness: number;
    score: number;
    status: TrendLine['status'];
  }

  const makeCandidates = (points: RawSwing[], kind: TrendLine['kind']): Candidate[] => {
    const found: Candidate[] = [];
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const a = points[first] as RawSwing;
        const b = points[second] as RawSwing;
        const span = b.index - a.index;
        if (span < Math.max(3, swingLookback)) continue;
        const slope = (b.price - a.price) / span;
        if (kind === 'rising_support' && slope <= 0) continue;
        if (kind === 'falling_resistance' && slope >= 0) continue;
        if ((Math.abs(slope) * candles.length) / referencePrice > TRENDLINE_MAX_STEEPNESS) continue;

        const touched = points.filter(
          (point) => Math.abs(point.price - lineValue(a, slope, point.index)) <= tolerance,
        );
        if (touched.length < 2) continue;

        const predicted = touched.map((point) => lineValue(a, slope, point.index));
        const prices = touched.map((point) => point.price);
        const mean = prices.reduce((total, value) => total + value, 0) / prices.length;
        const sst = prices.reduce((total, value) => total + (value - mean) ** 2, 0);
        const sse = prices.reduce((total, value, index) => total + (value - (predicted[index] as number)) ** 2, 0);
        const rSquared = sst === 0 ? null : Math.max(0, Math.min(1, 1 - sse / sst));

        const endPrice = lineValue(a, slope, lastIndex);
        const broken =
          kind === 'rising_support'
            ? referencePrice < endPrice - atrRef * 0.5
            : referencePrice > endPrice + atrRef * 0.5;
        const status: TrendLine['status'] = broken ? 'broken' : touched.length >= 3 ? 'active' : 'provisional';
        const steepness = Math.abs(slope) * candles.length / referencePrice;
        found.push({
          kind,
          slope,
          rSquared,
          touches: touched,
          endPrice,
          steepness,
          score: touched.length * 10 + (rSquared ?? 0) * 20 - steepness * 10,
          status,
        });
      }
    }
    return found;
  };

  const combined = [
    ...makeCandidates(swings.lows, 'rising_support'),
    ...makeCandidates(swings.highs, 'falling_resistance'),
  ].sort((a, b) => b.score - a.score);

  const lines: TrendLine[] = [];
  for (const candidate of combined) {
    if (
      lines.some(
        (line) =>
          line.kind === candidate.kind &&
          Math.abs(line.slopePerBar - candidate.slope) * candles.length <= tolerance &&
          Math.abs((line.endPoint.value as number) - candidate.endPrice) <= tolerance,
      )
    ) {
      continue;
    }
    const anchors = candidate.touches;
    const evidence = [
      `خط از ${anchors.length} سوئینگ تأییدشده عبور می‌کند.`,
      `شیب خط ${candidate.slope} واحد قیمت در هر کندل است.`,
    ];
    if (candidate.rSquared !== null) evidence.push(`ضریب تعیین برازش لنگرها ${round(candidate.rSquared, 3)} است.`);
    const warnings: string[] = [];
    if (candidate.status === 'provisional') warnings.push('این خط فقط دو لنگر تأییدشده دارد و آزمایشی است.');
    if (candidate.status === 'broken') warnings.push('قیمت با فاصله بیش از نیم ATR از خط عبور کرده؛ خط شکسته تلقی می‌شود.');
    if (candidate.steepness > 0.2) warnings.push('شیب خط تند است و احتمال برازش بیش‌ازحد دارد.');

    lines.push({
      id: `trendline-${lines.length + 1}`,
      kind: candidate.kind,
      status: candidate.status,
      anchors: [anchors[0] as RawSwing, anchors[anchors.length - 1] as RawSwing].map((anchor) => ({
        time: anchor.time,
        price: round(anchor.price),
        index: anchor.index,
        confirmedAtTime: anchor.confirmedAtTime,
      })),
      slopePerBar: round(candidate.slope, 10),
      rSquared: candidate.rSquared === null ? null : round(candidate.rSquared, 4),
      touches: anchors.length,
      toleranceAtr: TRENDLINE_TOLERANCE_ATR,
      endPoint: { time: lastTime, value: round(candidate.endPrice) },
      evidence,
      warnings,
    });
    if (lines.length >= maxLines) break;
  }

  return lines;
}

function horizonBars(timeframe: string): number {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  if (minutes === undefined) return 24;
  const target = minutes <= 240 ? 24 * 60 : 5 * 24 * 60;
  return Math.max(4, Math.min(48, Math.round(target / minutes)));
}

function buildPath(
  startPrice: number,
  endPrice: number,
  startTime: number,
  stepMs: number,
  horizon: number,
  atrRef: number,
): { path: ChartPoint[]; low: ChartPoint[]; high: ChartPoint[] } {
  const path: ChartPoint[] = [];
  const low: ChartPoint[] = [];
  const high: ChartPoint[] = [];
  const steps = 6;
  for (let step = 0; step <= steps; step += 1) {
    const fraction = step / steps;
    const value = startPrice + (endPrice - startPrice) * fraction;
    const time = startTime + Math.round(stepMs * horizon * fraction);
    const uncertainty = atrRef * Math.sqrt(Math.max(1e-9, horizon * fraction)) * 0.55;
    path.push({ time, value: round(value) });
    low.push({ time, value: round(Math.max(0, value - uncertainty)) });
    high.push({ time, value: round(value + uncertainty) });
  }
  return { path, low, high };
}

/** Conditional volatility-scaled projection with three scenarios. */
export function buildProjection(
  candles: Candle[],
  timeframe: string,
  structure: MarketStructure | null,
  zones: ZoneSet | null,
  trendlines: TrendLine[],
): MarketProjection | null {
  if (candles.length < 30) return null;
  const closes = candles.map((candle) => candle.close);
  const referencePrice = closes[closes.length - 1] as number;
  const referenceTime = (candles[candles.length - 1] as Candle).time;
  const atrRef = referenceAtr(candles);
  if (!atrRef || atrRef <= 0) return null;

  const minutes = TIMEFRAME_MINUTES[timeframe] ?? 60;
  const stepMs = minutes * 60_000;
  const horizon = horizonBars(timeframe);
  const horizonEndsAt = referenceTime + stepMs * horizon;
  const sigma = atrRef * Math.sqrt(horizon);
  const supportZone = zones?.supports.find((zone) => zone.status !== 'broken') ?? null;
  const resistanceZone = zones?.resistances.find((zone) => zone.status !== 'broken') ?? null;
  const direction = structure?.direction ?? 'unknown';
  const trendlineConfluence = trendlines.some((line) => line.status === 'active');

  const bullFloor = referencePrice + 0.35 * sigma;
  let bullTarget = resistanceZone ? Math.max(bullFloor, resistanceZone.zoneHigh) : referencePrice + 0.9 * sigma;
  bullTarget = Math.min(bullTarget, referencePrice + 1.9 * sigma);
  const bullLow = Math.max(bullFloor, bullTarget - 0.45 * sigma);
  const bullHigh = Math.max(bullLow, bullTarget);

  const bearCeiling = referencePrice - 0.35 * sigma;
  let bearTarget = supportZone ? Math.min(bearCeiling, supportZone.zoneLow) : referencePrice - 0.9 * sigma;
  bearTarget = Math.max(bearTarget, referencePrice - 1.9 * sigma);
  const bearHigh = Math.min(bearCeiling, bearTarget + 0.45 * sigma);
  const bearLow = Math.min(bearHigh, bearTarget);
  const baseLow = referencePrice - 0.35 * sigma;
  const baseHigh = referencePrice + 0.35 * sigma;

  const confidence = (aligned: boolean): ProjectionScenario['confidence'] =>
    aligned && (direction === 'bullish' || direction === 'bearish') && trendlineConfluence ? 'medium' : 'low';

  const dataWarnings: string[] = [];
  if (candles.length < 120) dataWarnings.push('تعداد کندل‌ها برای اعتبارسنجی تاریخی این افق کم است.');
  if (!zones || zones.higherTimeframeZones.length === 0) {
    dataWarnings.push('شواهد تایم‌فریم بالاتر برای این پیش‌بینی موجود نبود.');
  }
  if (!candles.some((candle) => candle.volume > 0)) {
    dataWarnings.push('داده حجم در دسترس نیست؛ سناریوها تنها بر قیمت و نوسان تکیه دارند.');
  }

  const bull = buildPath(referencePrice, (bullLow + bullHigh) / 2, referenceTime, stepMs, horizon, atrRef);
  const base = buildPath(referencePrice, referencePrice, referenceTime, stepMs, horizon, atrRef);
  const bear = buildPath(referencePrice, (bearLow + bearHigh) / 2, referenceTime, stepMs, horizon, atrRef);
  const directionLabel =
    direction === 'bullish' ? 'صعودی' : direction === 'bearish' ? 'نزولی' : 'رِنج';

  const scenarios: ProjectionScenario[] = [
    {
      id: 'bullish',
      name: 'ادامه یا شکست صعودی',
      activation: resistanceZone
        ? `بسته‌شدن یک کندل بالای سقف ناحیه مقاومت ${resistanceZone.zoneHigh} با فاصله حداقل ۰٫۱۵ برابر ATR.`
        : `بسته‌شدن یک کندل بالاتر از ${round(referencePrice + 0.5 * atrRef)} همراه با ساختار صعودی.`,
      invalidation: supportZone
        ? `بازگشت و بسته‌شدن زیر کف ناحیه حمایت ${supportZone.zoneLow}.`
        : `بسته‌شدن زیر ${round(referencePrice - 0.75 * atrRef)}.`,
      direction: 'up',
      targetLow: round(bullLow),
      targetHigh: round(bullHigh),
      projectedPath: bull.path,
      bandLow: bull.low,
      bandHigh: bull.high,
      confidence: confidence(direction === 'bullish'),
      confidenceMeaning: 'درجه شواهد (کم/متوسط)، نه احتمال وقوع',
      evidence: [
        `نوسان مرجع ATR برابر ${round(atrRef)} و افق ${horizon} کندل است.`,
        `ساختار فعلی: ${directionLabel}`,
      ],
      dataQualityWarnings: dataWarnings,
    },
    {
      id: 'base',
      name: 'ادامه نوسان / خنثی',
      activation:
        supportZone && resistanceZone
          ? 'ماندن قیمت بین ناحیه حمایت و مقاومت نزدیک و نداشتن بسته‌شدن تأییدشده بیرون از آن‌ها.'
          : 'نبود شکست تأییدشده در هیچ جهت و ماندن نوسان در محدوده ATR اخیر.',
      invalidation: 'بسته‌شدن تأییدشده بیرون از محدوده حمایت/مقاومت، این سناریو را کنار می‌گذارد.',
      direction: 'sideways',
      targetLow: round(baseLow),
      targetHigh: round(baseHigh),
      projectedPath: base.path,
      bandLow: base.low,
      bandHigh: base.high,
      confidence: 'low',
      confidenceMeaning: 'درجه شواهد (کم/متوسط)، نه احتمال وقوع',
      evidence: [`بازه پایه با ۰٫۳۵ برابر انحراف نوسانی افق (${round(0.35 * sigma)}) ساخته شده است.`],
      dataQualityWarnings: dataWarnings,
    },
    {
      id: 'bearish',
      name: 'رد یا شکست نزولی',
      activation: supportZone
        ? `بسته‌شدن یک کندل زیر کف ناحیه حمایت ${supportZone.zoneLow} با فاصله حداقل ۰٫۱۵ برابر ATR.`
        : `بسته‌شدن یک کندل زیر ${round(referencePrice - 0.5 * atrRef)} همراه با ساختار نزولی.`,
      invalidation: resistanceZone
        ? `بازگشت و بسته‌شدن بالای سقف ناحیه مقاومت ${resistanceZone.zoneHigh}.`
        : `بسته‌شدن بالای ${round(referencePrice + 0.75 * atrRef)}.`,
      direction: 'down',
      targetLow: round(bearLow),
      targetHigh: round(bearHigh),
      projectedPath: bear.path,
      bandLow: bear.low,
      bandHigh: bear.high,
      confidence: confidence(direction === 'bearish'),
      confidenceMeaning: 'درجه شواهد (کم/متوسط)، نه احتمال وقوع',
      evidence: [
        `نوسان مرجع ATR برابر ${round(atrRef)} و افق ${horizon} کندل است.`,
        `ساختار فعلی: ${directionLabel}`,
      ],
      dataQualityWarnings: dataWarnings,
    },
  ];

  return {
    experimental: true,
    method: 'volatility_scaled_conditional_ranges',
    version: PROJECTION_VERSION,
    referenceTime,
    referencePrice: round(referencePrice),
    horizonBars: horizon,
    horizonEndsAt,
    atr: round(atrRef),
    scenarios,
    warnings: ['این مسیر یک سناریوی شرطی و آزمایشی است؛ احتمال کالیبره‌شده یا پیش‌بینی قطعی قیمت نیست.'],
  };
}
