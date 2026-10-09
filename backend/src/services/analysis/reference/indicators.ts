/**
 * TypeScript reference implementation of the indicator maths.
 *
 * This mirrors `analysis-engine/nexora_analysis/indicators.py` bar for bar. It
 * exists so the platform keeps working on machines without a Python runtime.
 * Whenever the Python engine runs, its numbers win — this file is the fallback,
 * and the report always records which implementation produced the result.
 */

export type MaybeNumber = number | null;

export function sma(values: number[], period: number): MaybeNumber[] {
  if (period <= 0) throw new Error('period must be positive');
  const result: MaybeNumber[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let windowSum = 0;
  for (let index = 0; index < period; index += 1) windowSum += values[index] as number;
  result[period - 1] = windowSum / period;

  for (let index = period; index < values.length; index += 1) {
    windowSum += (values[index] as number) - (values[index - period] as number);
    result[index] = windowSum / period;
  }
  return result;
}

export function ema(values: number[], period: number): MaybeNumber[] {
  if (period <= 0) throw new Error('period must be positive');
  const result: MaybeNumber[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  const multiplier = 2 / (period + 1);
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index] as number;
  seed /= period;
  result[period - 1] = seed;

  let previous = seed;
  for (let index = period; index < values.length; index += 1) {
    previous = ((values[index] as number) - previous) * multiplier + previous;
    result[index] = previous;
  }
  return result;
}

/** Wilder's smoothing, the base of RSI and ATR. */
function wilderSmoothing(values: number[], period: number): MaybeNumber[] {
  const result: MaybeNumber[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  let running = 0;
  for (let index = 0; index < period; index += 1) running += values[index] as number;
  running /= period;
  result[period - 1] = running;

  for (let index = period; index < values.length; index += 1) {
    running = (running * (period - 1) + (values[index] as number)) / period;
    result[index] = running;
  }
  return result;
}

export function rsi(closes: number[], period = 14): MaybeNumber[] {
  if (period <= 1) throw new Error('rsi period must be greater than 1');
  const result: MaybeNumber[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  const gains: number[] = [];
  const losses: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const delta = (closes[index] as number) - (closes[index - 1] as number);
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }

  const avgGain = [null, ...wilderSmoothing(gains, period)];
  const avgLoss = [null, ...wilderSmoothing(losses, period)];

  for (let index = 0; index < closes.length; index += 1) {
    const gain = avgGain[index];
    const loss = avgLoss[index];
    if (gain === null || gain === undefined || loss === null || loss === undefined) continue;
    if (loss === 0) {
      result[index] = gain > 0 ? 100 : 50;
    } else {
      const relativeStrength = gain / loss;
      result[index] = 100 - 100 / (1 + relativeStrength);
    }
  }
  return result;
}

export interface MacdSeries {
  macd: MaybeNumber[];
  signal: MaybeNumber[];
  histogram: MaybeNumber[];
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdSeries {
  if (fastPeriod >= slowPeriod) {
    throw new Error('macd fast period must be shorter than the slow period');
  }

  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  const macdLine: MaybeNumber[] = closes.map((_, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    if (fastValue === null || fastValue === undefined) return null;
    if (slowValue === null || slowValue === undefined) return null;
    return fastValue - slowValue;
  });

  // Signal is an EMA over the defined portion of the MACD line, mapped back.
  const defined: Array<{ index: number; value: number }> = [];
  macdLine.forEach((value, index) => {
    if (value !== null && value !== undefined) defined.push({ index, value });
  });

  const signalLine: MaybeNumber[] = new Array(closes.length).fill(null);
  const histogram: MaybeNumber[] = new Array(closes.length).fill(null);

  if (defined.length >= signalPeriod) {
    const compactSignal = ema(
      defined.map((item) => item.value),
      signalPeriod,
    );
    defined.forEach((item, position) => {
      const signalValue = compactSignal[position];
      if (signalValue === null || signalValue === undefined) return;
      signalLine[item.index] = signalValue;
      histogram[item.index] = item.value - signalValue;
    });
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): MaybeNumber[] {
  if (highs.length !== lows.length || lows.length !== closes.length) {
    throw new Error('highs, lows and closes must have equal length');
  }
  if (closes.length < period + 1) return new Array(closes.length).fill(null);

  const trueRanges: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    trueRanges.push(
      Math.max(
        (highs[index] as number) - (lows[index] as number),
        Math.abs((highs[index] as number) - (closes[index - 1] as number)),
        Math.abs((lows[index] as number) - (closes[index - 1] as number)),
      ),
    );
  }

  return [null, ...wilderSmoothing(trueRanges, period)];
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function percentChange(first: number, last: number): number | null {
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

export function lastValue(series: MaybeNumber[]): number | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}
