import type { AnalysisReport } from '../../types/nexora';
import { AlertIcon, InfoIcon } from '../ui/Icons';

/**
 * Shown whenever a report did not complete.
 *
 * An `insufficient_data` or `unavailable` report contains no facts by design,
 * so this component is what the user sees instead of empty panels. It explains
 * what was missing and how to fix it, rather than showing a blank screen or —
 * worse — placeholder numbers.
 */
export function StatusNotice({ report }: { report: AnalysisReport }): JSX.Element | null {
  if (report.status === 'ok') return null;

  const unavailable = report.status === 'unavailable';
  const reason = report.warnings.find((warning) => warning.includes('کندل')) ?? report.warnings[0];

  return (
    <div
      role="alert"
      className={
        unavailable
          ? 'rounded-lg border border-bear/35 bg-bear/[0.07] px-4 py-4'
          : 'rounded-lg border border-warn/35 bg-warn/[0.07] px-4 py-4'
      }
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          {unavailable ? (
            <AlertIcon width={17} height={17} className="text-bear" />
          ) : (
            <InfoIcon width={17} height={17} className="text-warn" />
          )}
        </span>
        <div className="min-w-0">
          <p className={unavailable ? 'text-sm font-medium text-bear' : 'text-sm font-medium text-warn'}>
            {unavailable ? 'تحلیل انجام نشد' : 'داده کافی برای تحلیل وجود ندارد'}
          </p>
          <p className="mt-1.5 text-2xs leading-6 text-ink-muted">
            {reason ??
              'موتور تحلیل برای تولید نتیجه به کندل‌های معتبر بیشتری نیاز دارد. عمداً هیچ مقدار حدسی تولید نشد.'}
          </p>

          {!unavailable ? (
            <ul className="mt-2.5 space-y-1.5 text-2xs leading-6 text-ink-muted">
              <li className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>یک تایم‌فریم دیگر را امتحان کنید؛ تایم‌فریم‌های کوچک‌تر تعداد کندل بیشتری می‌دهند.</span>
              </li>
              <li className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>
                  مقدار <span className="ltr-data">limit</span> درخواست را افزایش دهید (پیش‌فرض ۳۰۰ کندل).
                </span>
              </li>
              <li className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>
                  این مجموعه اندیکاتورها به حداقل{' '}
                  <span className="num">۲۰۵</span> کندل نیاز دارد (به دلیل دوره SMA200 و خط سیگنال MACD).
                </span>
              </li>
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
