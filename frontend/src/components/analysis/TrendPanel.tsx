import { useFormat } from '../../context/SettingsContext';
import { cn } from '../../lib/cn';
import { TREND_LABELS } from '../../lib/format';
import type { AnalysisFacts } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';

const DIRECTION_TONE: Record<string, string> = {
  uptrend: 'text-bull',
  downtrend: 'text-bear',
  sideways: 'text-ink-muted',
  unknown: 'text-ink-subtle',
};

/**
 * Trend summary.
 *
 * `strength` is rendered as a bar because it is a bounded 0-100 score, and the
 * raw evidence lines are shown verbatim so the score is auditable rather than
 * an opaque number.
 */
export function TrendPanel({ trend }: { trend: NonNullable<AnalysisFacts['trend']> }): JSX.Element {
  const format = useFormat();
  const strength = trend.strength ?? 0;

  return (
    <Card>
      <CardHeader
        title="روند"
        description="روند از شیب خط برازش‌شده روی قیمت بسته‌شدن و ساختار سقف و کف محاسبه می‌شود."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xs text-ink-subtle">جهت روند</p>
            <p className={cn('mt-1 text-base font-semibold', DIRECTION_TONE[trend.direction] ?? 'text-ink')}>
              {TREND_LABELS[trend.direction] ?? trend.direction}
            </p>
          </div>
          <div className="text-end">
            <p className="text-2xs text-ink-subtle">قدرت اندازه‌گیری‌شده</p>
            <p className="num mt-1 text-base font-semibold text-ink">
              {trend.strength === null ? '—' : `${format.number(trend.strength, { precision: 1 })} / ۱۰۰`}
            </p>
          </div>
        </div>

        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={strength}
          aria-label="قدرت روند"
          className="h-1.5 w-full overflow-hidden rounded-full bg-base-700"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              trend.direction === 'downtrend' ? 'bg-bear' : trend.direction === 'uptrend' ? 'bg-bull' : 'bg-ink-subtle',
            )}
            style={{ width: `${Math.max(0, Math.min(100, strength))}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-base-900/40 px-3 py-2">
            <p className="text-2xs text-ink-subtle">سقف‌های بالاتر</p>
            <p className="mt-1 text-xs text-ink">
              {trend.higherHighs === null ? 'نامشخص' : trend.higherHighs ? 'بله' : 'خیر'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-base-900/40 px-3 py-2">
            <p className="text-2xs text-ink-subtle">کف‌های بالاتر</p>
            <p className="mt-1 text-xs text-ink">
              {trend.higherLows === null ? 'نامشخص' : trend.higherLows ? 'بله' : 'خیر'}
            </p>
          </div>
        </div>

        {trend.evidence.length > 0 ? (
          <div>
            <p className="mb-2 text-2xs font-medium text-ink-muted">شواهد محاسبه‌شده</p>
            <ul className="space-y-1.5">
              {trend.evidence.map((line, index) => (
                <li key={index} className="flex gap-2 text-2xs leading-6 text-ink-muted">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
