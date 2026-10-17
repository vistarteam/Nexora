/**
 * TypeScript reference implementation of trend classification.
 *
 * Mirrors `analysis-engine/nexora_analysis/trend.py` exactly, including the
 * t-statistic based decision, so the two engines agree on direction and strength
 * for the same input.
 */

import { findSwings } from './levels.js';

/** |t| at or above this is treated as a directed trend. */
export const TREND_T_THRESHOLD = 2.5;

/** |t| at which `strength` reaches 100 (see the Python module for the rationale). */
export const STRENGTH_SATURATION_T = 200;

export interface TrendReading {
  direction: 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
  strength: number | null;
  evidence: string[];
  higherHighs: boolean | null;
  higherLows: boolean | null;
  slopePercentPerCandle: number | null;
  /** Raw slope / standard-error(slope). `null` when not computable or infinite. */
  tStatistic: number | null;
}

/**
 * Least-squares fit of `values` against its own index.
 *
 * The index is the only regressor, so the fit is fully described by a slope and
 * an intercept: `price(i) = intercept + slope * i`. Both are `null` when the fit
 * is undefined (fewer than three points, or a degenerate x-spread).
 */
export function leastSquaresFit(values: number[]): {
  slope: number | null;
  intercept: number | null;
} {
  const count = values.length;
  if (count < 3) return { slope: null, intercept: null };

  const meanX = (count - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / count;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    numerator += (index - meanX) * ((values[index] as number) - meanY);
    denominator += (index - meanX) ** 2;
  }
  if (denominator === 0) return { slope: null, intercept: null };

  const slope = numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

export function linearRegressionSlope(values: number[]): number | null {
  return leastSquaresFit(values).slope;
}

/**
 * Least-squares trend line over the most recent `maxWindow` values.
 *
 * Returns the fit with the window it was computed over, so a chart can draw the
 * exact line the trend classification rests on. The regression is indexed from
 * the start of the window: `price(i) = intercept + slope * (i - startIndex)`.
 */
export function regressionLine(
  values: number[],
  maxWindow = 90,
): { slope: number; intercept: number; window: number; startIndex: number } | null {
  const window = Math.min(values.length, maxWindow);
  if (window < 3) return null;

  const { slope, intercept } = leastSquaresFit(values.slice(-window));
  if (slope === null || intercept === null) return null;

  return { slope, intercept, window, startIndex: values.length - window };
}

/**
 * Least-squares slope together with its t-statistic.
 *
 * `t` is `+Infinity` for a perfectly linear series and exactly `0` for a flat
 * one, so degenerate inputs classify deterministically instead of depending on
 * floating-point rounding.
 */
export function slopeTStatistic(values: number[]): {
  slope: number | null;
  t: number | null;
} {
  const count = values.length;
  if (count < 3) return { slope: null, t: null };

  const meanX = (count - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / count;

  let sxx = 0;
  let sxy = 0;
  for (let index = 0; index < count; index += 1) {
    sxx += (index - meanX) ** 2;
    sxy += (index - meanX) * ((values[index] as number) - meanY);
  }
  if (sxx === 0) return { slope: null, t: null };

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (let index = 0; index < count; index += 1) {
    const residual = (values[index] as number) - (intercept + slope * index);
    sse += residual * residual;
  }

  const degreesOfFreedom = count - 2;
  if (degreesOfFreedom <= 0) return { slope, t: null };

  const meanSquaredError = sse / degreesOfFreedom;
  if (meanSquaredError <= 0) {
    if (slope === 0) return { slope, t: 0 };
    return { slope, t: slope > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY };
  }

  const standardError = Math.sqrt(meanSquaredError / sxx);
  if (standardError === 0) return { slope, t: 0 };
  return { slope, t: slope / standardError };
}

function structure(
  highs: number[],
  lows: number[],
  lookback: number,
): { higherHighs: boolean; higherLows: boolean } {
  const { swingHighs, swingLows } = findSwings(highs, lows, lookback);

  let higherHighs = false;
  let higherLows = false;

  if (swingHighs.length >= 2) {
    const recent = swingHighs.slice(-3).map((point) => point.price);
    higherHighs = recent.slice(1).every((price, index) => price > (recent[index] as number));
  }
  if (swingLows.length >= 2) {
    const recent = swingLows.slice(-3).map((point) => point.price);
    higherLows = recent.slice(1).every((price, index) => price > (recent[index] as number));
  }

  return { higherHighs, higherLows };
}

export function classifyTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 5,
  maxWindow = 90,
): TrendReading {
  const window = Math.min(closes.length, maxWindow);
  const windowCloses = closes.slice(-window);
  const windowHighs = highs.slice(-window);
  const windowLows = lows.slice(-window);

  const { slope, t } = slopeTStatistic(windowCloses);
  const meanPrice =
    windowCloses.length > 0
      ? windowCloses.reduce((total, value) => total + value, 0) / windowCloses.length
      : 0;

  if (slope === null || meanPrice === 0) {
    return {
      direction: 'unknown',
      strength: null,
      evidence: ['داده کافی برای برازش روند وجود ندارد.'],
      higherHighs: null,
      higherLows: null,
      slopePercentPerCandle: null,
      tStatistic: null,
    };
  }

  const slopePercent = (slope / Math.abs(meanPrice)) * 100;

  const returns: number[] = [];
  for (let index = 1; index < windowCloses.length; index += 1) {
    const previous = windowCloses[index - 1] as number;
    if (previous !== 0) {
      returns.push(((windowCloses[index] as number) - previous) / previous);
    }
  }
  const meanReturn = returns.length === 0 ? 0 : returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.length === 0
      ? 0
      : returns.reduce((total, value) => total + (value - meanReturn) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);

  const { higherHighs, higherLows } = structure(windowHighs, windowLows, lookback);

  const isInfinite = t === Number.POSITIVE_INFINITY || t === Number.NEGATIVE_INFINITY;
  const signedT = t === null ? 0 : t;

  const direction: TrendReading['direction'] =
    signedT >= TREND_T_THRESHOLD
      ? 'uptrend'
      : signedT <= -TREND_T_THRESHOLD
        ? 'downtrend'
        : 'sideways';

  const strength = isInfinite
    ? 100
    : Number(
        (
          100 *
          (Math.log1p(Math.min(Math.abs(signedT), STRENGTH_SATURATION_T)) /
            Math.log1p(STRENGTH_SATURATION_T))
        ).toFixed(1),
      );

  const evidence = [
    `شیب خط برازش‌شده روی ${window} کندل برابر ${slopePercent.toFixed(4)} درصد در هر کندل است.`,
    isInfinite
      ? 'آماره t این شیب بی‌نهایت است: قیمت‌ها دقیقاً روی یک خط قرار دارند.'
      : `آماره t این شیب ${signedT >= 0 ? '+' : ''}${signedT.toFixed(2)} است ` +
        `(آستانه معناداری ${TREND_T_THRESHOLD}) و بنابراین ` +
        `${Math.abs(signedT) >= TREND_T_THRESHOLD ? 'معنادار' : 'قابل تفکیک از نویز نیست'} ارزیابی می‌شود.`,
    `نوسان بازده‌ها (انحراف معیار روی آخرین ${window} کندل روند) ` +
      `${(volatility * 100).toFixed(3)} درصد در هر کندل است.`,
    `ساختار سقف‌ها: سقف‌های بالاتر${higherHighs ? ' دیده می‌شود.' : ' دیده نمی‌شود.'}`,
    `ساختار کف‌ها: کف‌های بالاتر${higherLows ? ' دیده می‌شود.' : ' دیده نمی‌شود.'}`,
  ];

  return {
    direction,
    strength,
    evidence,
    higherHighs,
    higherLows,
    slopePercentPerCandle: Number(slopePercent.toFixed(6)),
    tStatistic: isInfinite ? null : Number(signedT.toFixed(4)),
  };
}
