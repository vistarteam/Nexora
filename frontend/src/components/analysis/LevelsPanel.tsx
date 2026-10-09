import { useFormat } from '../../context/SettingsContext';
import { cn } from '../../lib/cn';
import type { AnalysisFacts, SupportResistanceLevel } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/Feedback';

const KIND_LABELS: Record<string, string> = {
  swing: 'سوئینگ',
  pivot: 'پیوت',
};

function LevelTable({
  title,
  levels,
  tone,
}: {
  title: string;
  levels: SupportResistanceLevel[];
  tone: 'support' | 'resistance';
}): JSX.Element {
  const format = useFormat();

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={cn('text-xs font-medium', tone === 'support' ? 'text-bull' : 'text-bear')}>
          {title}
        </p>
        <span className="text-2xs text-ink-subtle">{format.integer(levels.length)} سطح</span>
      </div>

      {levels.length === 0 ? (
        <p className="rounded-lg border border-border bg-base-900/40 px-3 py-4 text-2xs text-ink-muted">
          سطح معتبری در این سمت قیمت شناسایی نشد.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="nx-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">قیمت</th>
                <th scope="col">فاصله از قیمت</th>
                <th scope="col">برخورد</th>
                <th scope="col">نوع</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => (
                <tr key={`${tone}-${level.price}-${level.kind}`}>
                  <td className="num text-ink">{format.number(level.price)}</td>
                  <td className={cn('num', tone === 'support' ? 'text-bull' : 'text-bear')}>
                    {format.percent(level.distancePercent)}
                  </td>
                  <td className="num text-ink-muted">{format.integer(level.touches)}</td>
                  <td className="text-2xs text-ink-subtle">{KIND_LABELS[level.kind] ?? level.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Support and resistance levels.
 *
 * The nearest level on each side is called out separately because that is the
 * actionable number; the full tables are reference material.
 */
export function LevelsPanel({
  levels,
}: {
  levels: NonNullable<AnalysisFacts['levels']>;
}): JSX.Element {
  const format = useFormat();

  return (
    <Card>
      <CardHeader
        title="سطوح حمایت و مقاومت"
        description="سطوح از سوئینگ‌های قیمتی و نقاط پیوت کلاسیک محاسبه شده‌اند."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-bull/30 bg-bull/[0.06] p-3">
            <p className="text-2xs text-ink-muted">نزدیک‌ترین حمایت</p>
            <p className="num mt-1 text-base font-semibold text-bull">
              {levels.nearestSupport ? format.number(levels.nearestSupport.price) : 'شناسایی نشد'}
            </p>
            {levels.nearestSupport ? (
              <p className="num mt-0.5 text-2xs text-ink-subtle">
                {format.percent(levels.nearestSupport.distancePercent)} ·{' '}
                {format.integer(levels.nearestSupport.touches)} برخورد
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-bear/30 bg-bear/[0.06] p-3">
            <p className="text-2xs text-ink-muted">نزدیک‌ترین مقاومت</p>
            <p className="num mt-1 text-base font-semibold text-bear">
              {levels.nearestResistance ? format.number(levels.nearestResistance.price) : 'شناسایی نشد'}
            </p>
            {levels.nearestResistance ? (
              <p className="num mt-0.5 text-2xs text-ink-subtle">
                {format.percent(levels.nearestResistance.distancePercent)} ·{' '}
                {format.integer(levels.nearestResistance.touches)} برخورد
              </p>
            ) : null}
          </div>
        </div>

        {levels.supports.length === 0 && levels.resistances.length === 0 ? (
          <EmptyState
            title="سطح کلیدی شناسایی نشد"
            description="با تعداد کندل بیشتر در این تایم‌فریم، سطوح معنادارتری قابل محاسبه است."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <LevelTable title="حمایت‌ها" levels={levels.supports} tone="support" />
            <LevelTable title="مقاومت‌ها" levels={levels.resistances} tone="resistance" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
