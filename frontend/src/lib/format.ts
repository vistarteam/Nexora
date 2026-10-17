import type { AnalysisStatus, AssetClass, DataMode, Timeframe } from '../types/nexora';

/**
 * Formatting helpers.
 *
 * One place decides how numbers and dates are rendered, so a policy change
 * (Persian vs Latin digits, calendar, precision) is a single edit. The numeral
 * style is a user setting and is threaded through every helper.
 */

export type NumeralStyle = 'fa' | 'en';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** Convert Latin digits in a string to Persian digits. */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

function applyNumeralStyle(value: string, style: NumeralStyle): string {
  return style === 'fa' ? toPersianDigits(value) : value;
}

/**
 * Prices need adaptive precision: EURUSD at 1.0875 and BTC at 63,400 cannot
 * share a format without either losing precision or showing noise.
 */
export function pricePrecision(value: number): number {
  const absolute = Math.abs(value);
  if (absolute === 0) return 2;
  if (absolute >= 1000) return 2;
  if (absolute >= 100) return 2;
  if (absolute >= 1) return 4;
  if (absolute >= 0.01) return 5;
  return 8;
}

export interface NumberOptions {
  style?: NumeralStyle;
  /** Fixed decimals. Omit to use `pricePrecision`. */
  precision?: number;
  /** Prefix with + for positive values. */
  signed?: boolean;
  /** Append a percent sign. */
  percent?: boolean;
  compact?: boolean;
}

export function formatNumber(value: number | null | undefined, options: NumberOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { style = 'fa', signed = false, percent = false, compact = false } = options;
  const precision = options.precision ?? pricePrecision(value);

  let body: string;
  if (compact && Math.abs(value) >= 10_000) {
    body = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } else {
    body = value.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  let result = body;
  if (signed && value > 0) result = `+${result}`;
  if (percent) result = `${result}٪`;

  return applyNumeralStyle(result, style);
}

/** Percent values arrive already multiplied by 100 from the API. */
export function formatPercent(
  value: number | null | undefined,
  options: NumberOptions = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatNumber(value, { precision: 2, signed: true, percent: true, ...options });
}

export function formatInteger(value: number | null | undefined, style: NumeralStyle = 'fa'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return applyNumeralStyle(Math.round(value).toLocaleString('en-US'), style);
}

const dateTimeFormatter = new Intl.DateTimeFormat('fa-IR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });

/** Persian (Jalali) calendar date + time, the expected format in an Iranian product. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** Relative time in Persian, falling back to an absolute date beyond a month. */
export function formatRelative(iso: string | null | undefined, style: NumeralStyle = 'fa'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'همین حالا';
  if (seconds < 90) return 'یک دقیقه پیش';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${applyNumeralStyle(String(minutes), style)} دقیقه پیش`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${applyNumeralStyle(String(hours), style)} ساعت پیش`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${applyNumeralStyle(String(days), style)} روز پیش`;

  return formatDate(iso);
}

/** Duration in a human Persian form, used by performance notes. */
export function formatDuration(ms: number, style: NumeralStyle = 'fa'): string {
  if (ms < 1000) return `${applyNumeralStyle(String(Math.round(ms)), style)} میلی‌ثانیه`;
  return `${applyNumeralStyle((ms / 1000).toFixed(1), style)} ثانیه`;
}

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  crypto: 'ارز دیجیتال',
  forex: 'فارکس',
  stocks: 'سهام',
};

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1m': '۱ دقیقه',
  '5m': '۵ دقیقه',
  '15m': '۱۵ دقیقه',
  '1h': '۱ ساعت',
  '4h': '۴ ساعت',
  '1d': 'روزانه',
  '1w': 'هفتگی',
};

export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  ok: 'تحلیل کامل',
  insufficient_data: 'داده ناکافی',
  unavailable: 'در دسترس نیست',
};

export const DATA_MODE_LABELS: Record<DataMode, string> = {
  live: 'داده واقعی',
  none: 'بدون داده',
};

export const TREND_LABELS: Record<string, string> = {
  uptrend: 'صعودی',
  downtrend: 'نزولی',
  sideways: 'بدون روند',
  unknown: 'نامشخص',
};

export const ENGINE_LABELS: Record<string, string> = {
  python: 'موتور پایتون',
  'typescript-fallback': 'جایگزین تایپ‌اسکریپت',
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  low: 'کم',
  medium: 'متوسط',
  high: 'بالا',
};

export const SIGNAL_LABELS: Record<string, string> = {
  bullish: 'صعودی',
  bearish: 'نزولی',
  neutral: 'بی‌طرف',
  unknown: 'نامشخص',
};

/** Tailwind text-colour class for a signed value. */
export function toneForChange(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-ink-muted';
  if (value > 0) return 'text-bull';
  if (value < 0) return 'text-bear';
  return 'text-ink-muted';
}

export function toneForSignal(signal: string | undefined): string {
  if (signal === 'bullish') return 'text-bull';
  if (signal === 'bearish') return 'text-bear';
  return 'text-ink-muted';
}
