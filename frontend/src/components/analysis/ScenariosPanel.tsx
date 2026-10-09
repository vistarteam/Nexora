import { cn } from '../../lib/cn';
import { CONFIDENCE_LABELS } from '../../lib/format';
import type { AnalysisScenario } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Badge, type BadgeTone } from '../ui/Badge';
import { EmptyState } from '../ui/Feedback';

const BIAS_LABELS: Record<AnalysisScenario['bias'], string> = {
  bullish: 'سناریوی صعودی',
  bearish: 'سناریوی نزولی',
  neutral: 'سناریوی بی‌طرف',
};

const BIAS_TONES: Record<AnalysisScenario['bias'], BadgeTone> = {
  bullish: 'bull',
  bearish: 'bear',
  neutral: 'neutral',
};

const CONFIDENCE_TONES: Record<AnalysisScenario['confidence'], BadgeTone> = {
  low: 'neutral',
  medium: 'info',
  high: 'accent',
};

/**
 * Conditional scenarios.
 *
 * Each scenario states the condition that would activate it and the condition
 * that would invalidate it. They are explicitly labelled as hypothetical:
 * this component never renders a "prediction".
 */
export function ScenariosPanel({ scenarios }: { scenarios: AnalysisScenario[] }): JSX.Element {
  return (
    <Card>
      <CardHeader
        title="سناریوهای شرطی"
        description="این موارد پیش‌بینی نیستند؛ هر سناریو تنها در صورت تحقق شرط ذکرشده معنا دارد و شرط بطلان آن نیز آمده است."
        actions={<Badge tone="neutral">{scenarios.length} سناریو</Badge>}
      />
      <CardBody>
        {scenarios.length === 0 ? (
          <EmptyState
            title="سناریویی تولید نشد"
            description="برای ساخت سناریوی شرطی، به سطوح حمایت یا مقاومت معتبر نیاز است. با داده بیشتر این بخش پر می‌شود."
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {scenarios.map((scenario) => (
              <li
                key={scenario.id}
                className={cn(
                  'rounded-lg border bg-base-900/40 p-3.5 transition',
                  scenario.bias === 'bullish'
                    ? 'border-bull/30'
                    : scenario.bias === 'bearish'
                      ? 'border-bear/30'
                      : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-ink">{scenario.title}</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={BIAS_TONES[scenario.bias]}>{BIAS_LABELS[scenario.bias]}</Badge>
                    <Badge tone={CONFIDENCE_TONES[scenario.confidence]}>
                      اطمینان: {CONFIDENCE_LABELS[scenario.confidence]}
                    </Badge>
                  </div>
                </div>

                <dl className="mt-3 space-y-2.5">
                  <div>
                    <dt className="text-2xs font-medium text-accent">شرط فعال‌شدن</dt>
                    <dd className="mt-1 text-2xs leading-6 text-ink-muted">{scenario.condition}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-medium text-bear">شرط باطل‌شدن</dt>
                    <dd className="mt-1 text-2xs leading-6 text-ink-muted">{scenario.invalidation}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
