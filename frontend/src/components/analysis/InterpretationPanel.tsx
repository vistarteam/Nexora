import { useSettings } from '../../context/SettingsContext';
import type { AnalysisInterpretation } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { InfoIcon } from '../ui/Icons';

/**
 * Interpretation section.
 *
 * Its whole purpose is to be visibly separate from the facts panel: the header
 * says so, and the caveats are rendered by default (the user can hide them in
 * Settings, but the disclaimer line remains).
 */
export function InterpretationPanel({
  interpretation,
}: {
  interpretation: AnalysisInterpretation;
}): JSX.Element {
  const { settings } = useSettings();

  return (
    <Card rail>
      <CardHeader
        title="تفسیر"
        description="این بخش خوانش سیستم از اعداد بخش «اندیکاتورها» است، نه داده جدید و نه توصیه معاملاتی."
      />
      <CardBody className="space-y-4">
        <p className="rounded-lg border border-border bg-base-900/50 p-3.5 text-xs leading-7 text-ink">
          {interpretation.summary}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <ReadingBlock title="خوانش روند" body={interpretation.trendReading} />
          <ReadingBlock title="خوانش مومنتوم" body={interpretation.momentumReading} />
          <ReadingBlock title="خوانش نوسان" body={interpretation.volatilityReading} />
          <ReadingBlock
            title="سطح اطمینان"
            body="این خوانش‌ها بر پایه داده تاریخی است و هیچ تضمینی برای آینده ارائه نمی‌دهد."
          />
        </div>

        {settings.showCaveats && interpretation.caveats.length > 0 ? (
          <div className="rounded-lg border border-warn/30 bg-warn/[0.06] p-3.5">
            <p className="flex items-center gap-1.5 text-2xs font-medium text-warn">
              <InfoIcon width={14} height={14} />
              محدودیت‌ها و هشدارها
            </p>
            <ul className="mt-2 space-y-1.5">
              {interpretation.caveats.map((caveat, index) => (
                <li key={index} className="flex gap-2 text-2xs leading-6 text-ink-muted">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warn/80" />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ReadingBlock({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-base-900/40 p-3">
      <p className="text-2xs font-medium text-ink-muted">{title}</p>
      <p className="mt-1.5 text-2xs leading-6 text-ink">{body}</p>
    </div>
  );
}
