import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../types/nexora';
import { buildReportText, reportFileName } from './reportExport';

function report(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    id: 'r1',
    symbol: 'BINANCE:BTCUSDT',
    tvSymbol: 'BINANCE:BTCUSDT',
    name: 'بیت‌کوین / تتر',
    assetClass: 'crypto',
    timeframe: '1h',
    createdAt: '2026-10-14T14:30:00.000Z',
    dataTimestamp: '2026-10-14T14:00:00.000Z',
    mode: 'live',
    dataSource: 'nobitex',
    engine: { id: 'python', name: 'nexora-analysis-engine', version: '0.3.0' },
    status: 'ok',
    facts: {
      lastCandle: {
        time: 1_700_000_000_000,
        open: 81_000,
        high: 82_000,
        low: 80_500,
        close: 81_500,
        volume: 3,
      },
      candleCount: 300,
      changePercent: 1.5,
      volatilityPercent: 0.5,
      indicators: {
        rsi: { value: 35.81, state: 'bearish_bias', signal: 'bearish' },
        macd: { macd: -178.29, signal: -19.48, histogram: -158.82, state: 'bearish_widening' },
        sma: [{ period: 200, value: 83_200, state: 'below', signal: 'bearish' }],
        ema: [{ period: 9, value: 81_900, state: 'below', signal: 'bearish' }],
        atr: { value: 528.46 },
      },
      trend: {
        direction: 'downtrend',
        strength: 27.2,
        evidence: ['شیب اندازه‌گیری‌شده منفی است.'],
        higherHighs: false,
        higherLows: false,
      },
      levels: {
        supports: [{ price: 81_100, touches: 3, distancePercent: -0.5, kind: 'swing' }],
        resistances: [{ price: 82_434, touches: 1, distancePercent: 1.2, kind: 'pivot' }],
        nearestSupport: { price: 81_100, touches: 3, distancePercent: -0.5, kind: 'swing' },
        nearestResistance: { price: 82_434, touches: 1, distancePercent: 1.2, kind: 'pivot' },
      },
    },
    interpretation: {
      summary: 'روند نزولی خوانده می‌شود.',
      trendReading: 'شیب منفی است.',
      momentumReading: 'RSI در ناحیه ضعیف است.',
      volatilityReading: 'نوسان متوسط است.',
      caveats: ['این خوانش قطعی نیست.'],
    },
    scenarios: [
      {
        id: 's1',
        title: 'شکست حمایت نزدیک',
        bias: 'bearish',
        condition: 'بسته‌شدن زیر 81100',
        invalidation: 'بازگشت بالای 81100',
        confidence: 'medium',
      },
    ],
    warnings: ['جدیدترین کندل در حال تشکیل است.'],
    disclaimer: 'توصیه سرمایه‌گذاری نیست.',
    ...overrides,
  };
}

describe('reportFileName', () => {
  it('builds a filesystem-safe name from symbol, timeframe and time', () => {
    const name = reportFileName(report(), 'md');
    expect(name.startsWith('nexora-BINANCE-BTCUSDT-1h-')).toBe(true);
    expect(name.endsWith('.md')).toBe(true);
    expect(name).not.toMatch(/[:]/);
  });
});

describe('buildReportText', () => {
  it('states the report provenance, so a reading is never separated from its source', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('BINANCE:BTCUSDT');
    expect(text).toContain('nobitex');
    expect(text).toContain('nexora-analysis-engine 0.3.0');
    expect(text).toContain('کامل');
  });

  it('separates computed facts from interpretation', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('اندیکاتورها');
    expect(text).toContain('RSI');
    expect(text).toContain('-178.29');
    expect(text).toContain('تفسیر');
    expect(text).toContain('روند نزولی خوانده می‌شود.');
  });

  it('includes trend direction in Persian and the strength score', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('نزولی');
    expect(text).toContain('27.2');
  });

  it('renders support and resistance as a table with touch counts', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('| 81,100.00 |');
    expect(text).toContain('| 82,434.00 |');
    expect(text).toContain('سوئینگ');
    expect(text).toContain('پیوت');
  });

  it('lists scenarios with both the condition and the invalidation', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('شکست حمایت نزدیک');
    expect(text).toContain('شرط فعال‌شدن: بسته‌شدن زیر 81100');
    expect(text).toContain('شرط باطل‌شدن: بازگشت بالای 81100');
  });

  it('always ends with the disclaimer, and lists warnings', () => {
    const text = buildReportText(report(), { style: 'en' });
    expect(text).toContain('جدیدترین کندل در حال تشکیل است.');
    expect(text).toContain('**سلب مسئولیت:** توصیه سرمایه‌گذاری نیست.');
  });

  it('still produces a readable document for a report with no facts', () => {
    const text = buildReportText(
      report({ status: 'insufficient_data', facts: null, interpretation: null, scenarios: [] }),
      { style: 'en' },
    );
    expect(text).toContain('داده ناکافی');
    expect(text).toContain('**سلب مسئولیت:**');
    expect(text).not.toContain('## اندیکاتورها');
  });

  it('uses Persian numerals when asked', () => {
    const text = buildReportText(report(), { style: 'fa' });
    expect(text).toContain('۸۱,۵۰۰.۰۰');
  });
});
