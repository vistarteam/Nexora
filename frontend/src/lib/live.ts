import type { Candle, TickerSnapshot } from '../types/nexora';
import { toPersianDigits, type NumeralStyle } from './format';

/**
 * Live-chart helpers.
 *
 * Pure functions only: the polling hook and the chart component stay thin, and
 * the two rules that actually matter — how a live bar is folded into the series,
 * and how a countdown is rendered — are unit-testable without a DOM or a clock.
 */

/** Upper bound on the series a long-running live session can grow to. */
export const MAX_LIVE_CANDLES = 600;

/**
 * Fold a live bar into the series the engine produced.
 *
 * Three cases, and each one matters:
 *  - same open time: replace the forming bar in place, so every overlay point
 *    (which is addressed by the bar's time) still lines up with its candle;
 *  - later time: append, because a new period has begun and the previous bar is
 *    now final;
 *  - earlier time: ignore. A slow or out-of-order poll must never walk the
 *    series backwards and draw a candle underneath one that already closed.
 *
 * The result is capped so leaving a tab open for days cannot grow the array
 * without bound.
 */
export function mergeLiveCandle(
  candles: Candle[],
  candle: Candle,
  maxCandles: number = MAX_LIVE_CANDLES,
): Candle[] {
  if (candles.length === 0) return [candle];

  const last = candles[candles.length - 1] as Candle;
  let next: Candle[];
  if (candle.time === last.time) {
    next = [...candles.slice(0, -1), candle];
  } else if (candle.time < last.time) {
    return candles;
  } else {
    next = [...candles, candle];
  }

  return next.length > maxCandles ? next.slice(next.length - maxCandles) : next;
}

/**
 * Time remaining, as `H:MM:SS`.
 *
 * Hours are not wrapped at 24: a daily bar legitimately counts down from 24 and
 * a weekly one from 168, and `167:12:04` is more honest than `23:12:04`. A
 * negative or missing value clamps to zero rather than showing a minus sign:
 * once the close time has passed the bar is simply overdue.
 */
export function formatCountdown(
  seconds: number | null | undefined,
  style: NumeralStyle = 'fa',
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const body = `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return style === 'fa' ? toPersianDigits(body) : body;
}

/** Wall-clock time of day, `HH:MM:SS`, in the viewer's local timezone. */
export function formatClock(
  iso: string | null | undefined,
  style: NumeralStyle = 'fa',
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const body = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  return style === 'fa' ? toPersianDigits(body) : body;
}

/**
 * The one-line description of the live tape, used as the chart's price-line
 * label and its header badge.
 */
export function describeLiveCandle(
  snapshot: TickerSnapshot | null,
  secondsToClose: number | null,
  style: NumeralStyle = 'fa',
): string {
  if (!snapshot) return 'بدون داده زنده';
  const close = formatClock(snapshot.candleCloseAt, style);
  const remaining = formatCountdown(secondsToClose, style);
  return `بسته‌شدن کندل: ${close} (${remaining} مانده)`;
}

/**
 * The compact form used as a price-line label on the right-hand scale.
 *
 * Deliberately terse: the axis also carries the engine's support and resistance
 * labels, and a full sentence there collides with them. The price itself is drawn
 * by the scale, so only the time and the remaining seconds are repeated here.
 */
export function describeLiveClose(
  snapshot: TickerSnapshot | null,
  secondsToClose: number | null,
  style: NumeralStyle = 'fa',
): string {
  if (!snapshot) return '';
  return `بستن ${formatClock(snapshot.candleCloseAt, style)} · ${formatCountdown(
    secondsToClose,
    style,
  )}`;
}
