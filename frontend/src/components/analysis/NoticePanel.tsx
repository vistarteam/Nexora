import type { AnalysisReport } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { AlertIcon, InfoIcon } from '../ui/Icons';

/**
 * Warnings and the standing disclaimer.
 *
 * Runtime warnings (skipped candles, fallback engine, demo data) are rendered
 * here. They are never swallowed: if the engine had to improvise, the user is
 * told exactly how.
 */
export function NoticePanel({ report }: { report: AnalysisReport }): JSX.Element {
  return (
    <Card>
      <CardHeader
        title="هشدارها و سلب مسئولیت"
        description="هر محدودیت یا مشکل در جریان تولید این گزارش در همین بخش گزارش می‌شود."
      />
      <CardBody className="space-y-3">
        {report.warnings.length > 0 ? (
          <ul className="space-y-2">
            {report.warnings.map((warning, index) => (
              <li
                key={index}
                className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/[0.05] px-3 py-2.5"
              >
                <AlertIcon width={15} height={15} className="mt-0.5 shrink-0 text-warn" />
                <span className="text-2xs leading-6 text-ink-muted">{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border bg-base-900/40 px-3 py-2.5 text-2xs text-ink-muted">
            هشدار زمان اجرا ثبت نشده است.
          </p>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-base-900/50 px-3 py-2.5">
          <InfoIcon width={15} height={15} className="mt-0.5 shrink-0 text-ink-subtle" />
          <p className="text-2xs leading-6 text-ink-muted">
            <span className="font-medium text-ink">سلب مسئولیت: </span>
            {report.disclaimer}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
