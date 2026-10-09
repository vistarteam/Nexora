import { useFormat } from '../../context/SettingsContext';
import { cn } from '../../lib/cn';
import { SIGNAL_LABELS, toneForSignal } from '../../lib/format';
import type { AnalysisFacts, MovingAverageSnapshot } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/Feedback';

/**
 * The "facts" column of the report: numbers computed from candles, with no
 * interpretation attached. Interactions between these values are discussed in
 * the interpretation panel instead, which is clearly separated.
 */

function SignalPill({ signal }: { signal?: string }): JSX.Element {
  return (
    <span className={cn('text-2xs', toneForSignal(signal))}>
      {SIGNAL_LABELS[signal ?? 'unknown'] ?? signal}
    </span>
  );
}

function IndicatorRow({
  label,
  value,
  signal,
  state,
  hint,
}: {
  label: string;
  value: string;
  signal?: string;
  state?: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        {state ? <p className="ltr-data mt-0.5 text-2xs text-ink-subtle">{state}</p> : null}
        {hint ? <p className="mt-0.5 text-2xs leading-5 text-ink-subtle">{hint}</p> : null}
      </div>
      <div className="shrink-0 text-end">
        <p className="num text-sm font-medium text-ink">{value}</p>
        {signal ? <SignalPill signal={signal} /> : null}
      </div>
    </div>
  );
}

function MaList({
  title,
  items,
  formatValue,
}: {
  title: string;
  items: MovingAverageSnapshot[];
  formatValue: (value: number) => string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-base-900/40 p-3">
      <p className="mb-2 text-2xs font-medium text-ink-muted">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.period} className="flex items-center justify-between gap-2 text-2xs">
            <span className="ltr-data text-ink-subtle">
              {title.includes('نمایی') ? 'EMA' : 'SMA'} {item.period}
            </span>
            <span className="num text-ink">
              {item.value === null ? 'در حال گرم‌شدن' : formatValue(item.value)}
            </span>
            <span className={cn('shrink-0', toneForSignal(item.signal))}>
              {item.state === 'above' ? 'بالاتر' : item.state === 'below' ? 'پایین‌تر' : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IndicatorGrid({ facts }: { facts: AnalysisFacts }): JSX.Element {
  const format = useFormat();
  const rsi = facts.indicators.rsi;
  const macd = facts.indicators.macd;
  const atr = facts.indicators.atr;

  return (
    <Card>
      <CardHeader
        title="اندیکاتورها"
        description="مقادیر زیر مستقیماً از کندل‌های دریافتی محاسبه شده‌اند و تفسیر نیستند."
      />
      <CardBody className="space-y-4">
        <div>
          <IndicatorRow
            label="RSI"
            value={rsi?.value === null || rsi?.value === undefined ? '—' : format.number(rsi.value, { precision: 2 })}
            {...(rsi?.signal ? { signal: rsi.signal } : {})}
            {...(rsi?.state ? { state: rsi.state } : {})}
            hint="شاخص قدرت نسبی با دوره ۱۴ و هموارسازی وایلدر"
          />
          <IndicatorRow
            label="MACD"
            value={
              macd?.macd === null || macd?.macd === undefined
                ? '—'
                : format.number(macd.macd, { precision: 4 })
            }
            {...(macd?.signalDirection ? { signal: macd.signalDirection } : {})}
            {...(macd?.state ? { state: macd.state } : {})}
            hint="خط MACD، خط سیگنال و هیستوگرام در بخش جزئیات"
          />
          <IndicatorRow
            label="ATR"
            value={atr?.value === null || atr?.value === undefined ? '—' : format.number(atr.value, { precision: 4 })}
            hint="میانگین دامنه واقعی — معیار نوسان، نه جهت"
          />
        </div>

        {macd ? (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-base-900/40 p-3">
            <div>
              <p className="text-2xs text-ink-subtle">خط MACD</p>
              <p className="num mt-1 text-xs text-ink">
                {macd.macd === null ? '—' : format.number(macd.macd, { precision: 4 })}
              </p>
            </div>
            <div>
              <p className="text-2xs text-ink-subtle">خط سیگنال</p>
              <p className="num mt-1 text-xs text-ink">
                {macd.signal === null ? '—' : format.number(macd.signal, { precision: 4 })}
              </p>
            </div>
            <div>
              <p className="text-2xs text-ink-subtle">هیستوگرام</p>
              <p
                className={cn(
                  'num mt-1 text-xs',
                  (macd.histogram ?? 0) > 0 ? 'text-bull' : (macd.histogram ?? 0) < 0 ? 'text-bear' : 'text-ink',
                )}
              >
                {macd.histogram === null ? '—' : format.number(macd.histogram, { precision: 4 })}
              </p>
            </div>
          </div>
        ) : null}

        {facts.indicators.sma.length === 0 && facts.indicators.ema.length === 0 ? (
          <EmptyState
            title="میانگین‌های متحرک محاسبه نشد"
            description="برای محاسبه میانگین متحرک، تعداد کندل کافی در دسترس نبود."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <MaList
              title="میانگین متحرک ساده (SMA)"
              items={facts.indicators.sma}
              formatValue={(value) => format.number(value)}
            />
            <MaList
              title="میانگین متحرک نمایی (EMA)"
              items={facts.indicators.ema}
              formatValue={(value) => format.number(value)}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
