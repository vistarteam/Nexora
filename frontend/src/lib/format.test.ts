import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatPercent,
  formatRelative,
  pricePrecision,
  toPersianDigits,
  toneForChange,
} from './format';

describe('toPersianDigits', () => {
  it('maps every Latin digit to its Persian counterpart', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
  });

  it('leaves non-digit characters untouched', () => {
    expect(toPersianDigits('BTC 12,345.67')).toBe('BTC ۱۲,۳۴۵.۶۷');
  });
});

describe('pricePrecision', () => {
  it('adapts to the magnitude of the value', () => {
    expect(pricePrecision(63_400)).toBe(2);
    expect(pricePrecision(214.5)).toBe(2);
    expect(pricePrecision(1.0875)).toBe(4);
    expect(pricePrecision(0.00012)).toBe(8);
  });
});

describe('formatNumber', () => {
  it('renders Persian digits by default', () => {
    expect(formatNumber(1234.5, { precision: 1 })).toBe('۱,۲۳۴.۵');
  });

  it('renders Latin digits when requested', () => {
    expect(formatNumber(1234.5, { precision: 1, style: 'en' })).toBe('1,234.5');
  });

  it('adds a sign only for positive values when signed', () => {
    expect(formatNumber(12.34, { precision: 2, signed: true, style: 'en' })).toBe('+12.34');
    expect(formatNumber(-12.34, { precision: 2, signed: true, style: 'en' })).toBe('-12.34');
  });

  it('returns an em dash for missing values instead of NaN', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('uses compact notation for large magnitudes when asked', () => {
    expect(formatNumber(1_250_000, { compact: true, style: 'en' })).toBe('1.3M');
  });
});

describe('formatPercent', () => {
  it('appends the Persian percent sign and a sign', () => {
    expect(formatPercent(2.5, { style: 'en' })).toBe('+2.50٪');
    expect(formatPercent(-2.5, { style: 'en' })).toBe('-2.50٪');
  });

  it('handles null', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatRelative', () => {
  it('describes very recent timestamps in words', () => {
    expect(formatRelative(new Date().toISOString())).toBe('همین حالا');
  });

  it('falls back to a date for old timestamps instead of "999 days ago"', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelative(old);
    expect(result).not.toContain('روز پیش');
    expect(result).not.toBe('—');
  });

  it('handles invalid input', () => {
    expect(formatRelative('not-a-date')).toBe('—');
    expect(formatRelative(null)).toBe('—');
  });
});

describe('toneForChange', () => {
  it('maps sign to a class', () => {
    expect(toneForChange(1)).toBe('text-bull');
    expect(toneForChange(-1)).toBe('text-bear');
    expect(toneForChange(0)).toBe('text-ink-muted');
    expect(toneForChange(null)).toBe('text-ink-muted');
  });
});
