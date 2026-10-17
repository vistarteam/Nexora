import { useFormat } from '../../context/SettingsContext';
import { useSystem } from '../../context/SystemContext';
import { ENGINE_LABELS } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ErrorState, Skeleton } from '../ui/Feedback';
import { RefreshIcon } from '../ui/Icons';

function CheckRow({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'error';
  detail?: string;
}): JSX.Element {
  const toneClass =
    tone === 'ok' ? 'text-bull' : tone === 'warn' ? 'text-warn' : 'text-bear';

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        {detail ? <p className="mt-0.5 break-words text-2xs leading-5 text-ink-subtle">{detail}</p> : null}
      </div>
      <p className={cn('shrink-0 text-xs font-medium', toneClass)}>{value}</p>
    </div>
  );
}

/**
 * Market-data connection status.
 *
 * Explicitly distinguishes three things that are easy to conflate: whether the
 * API is reachable, whether a real data provider is configured, and whether the
 * analysis engine is available. Only a configured provider is shown as serving
 * market data.
 */
export function ConnectionPanel(): JSX.Element {
  const { health, error, refreshHealth } = useSystem();
  const format = useFormat();

  const apiOk = Boolean(health) && !error;
  const engineOk = health?.checks.analysisEngine.status === 'available';
  const marketMode = health?.checks.marketData.mode ?? 'none';
  const storagePersistent = health?.checks.storage.persistent ?? false;

  return (
    <Card>
      <CardHeader
        title="وضعیت اتصال و سرویس‌ها"
        description="وضعیت واقعی زیرسامانه‌ها؛ اتصال API، منبع داده بازار، موتور تحلیل و ذخیره‌سازی."
        actions={
          <Button size="sm" variant="ghost" onClick={() => void refreshHealth()} aria-label="بررسی مجدد وضعیت">
            <RefreshIcon width={14} height={14} />
            <span className="text-2xs">بررسی مجدد</span>
          </Button>
        }
      />

      <CardBody className="space-y-3">
        {!health && error ? <ErrorState error={error} onRetry={() => void refreshHealth()} /> : null}

        {!health && !error ? (
          <div className="space-y-3">
            <Skeleton lines={2} />
            <Skeleton lines={2} />
          </div>
        ) : null}

        {health ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={apiOk ? 'bull' : 'bear'} dot>
                {apiOk ? 'API در دسترس' : 'API در دسترس نیست'}
              </Badge>
              <Badge tone={health.status === 'ok' ? 'accent' : 'warn'} dot>
                {health.status === 'ok' ? 'سلامت کلی: مطلوب' : 'سلامت کلی: نیازمند بررسی'}
              </Badge>
              <Badge tone="neutral">
                نسخه <span className="ltr-data">{health.version}</span>
              </Badge>
            </div>

            <div>
              <CheckRow
                label="منبع داده بازار"
                value={marketMode === 'live' ? 'داده واقعی' : 'پیکربندی نشده'}
                tone={marketMode === 'live' ? 'ok' : 'error'}
                detail={
                  marketMode === 'live'
                    ? health.checks.marketData.detail
                    : 'منبع داده‌ای پیکربندی نشده است؛ در فایل .env مقدار MARKET_DATA_PROVIDER را تنظیم کنید.'
                }
              />

              <CheckRow
                label="موتور تحلیل"
                value={engineOk ? 'در دسترس' : 'خارج از دسترس'}
                tone={engineOk ? 'ok' : 'warn'}
                detail={
                  engineOk
                    ? `${ENGINE_LABELS[health.checks.analysisEngine.id] ?? health.checks.analysisEngine.id} — ${health.checks.analysisEngine.detail ?? ''}`
                    : `پایتون در دسترس نبود؛ در صورت فعال بودن، از پیاده‌سازی جایگزین استفاده می‌شود. ${health.checks.analysisEngine.detail ?? ''}`
                }
              />

              <CheckRow
                label="ذخیره‌سازی"
                value={storagePersistent ? 'پایدار' : 'غیرپایدار'}
                tone={storagePersistent ? 'ok' : 'warn'}
                detail={
                  storagePersistent
                    ? `درایور ${health.checks.storage.driver}`
                    : `درایور ${health.checks.storage.driver} — تاریخچه و واچ‌لیست با راه‌اندازی مجدد سرور پاک می‌شود.`
                }
              />

              <CheckRow
                label="زمان فعالیت سرویس"
                value={format.duration(health.uptimeSeconds * 1000)}
                tone="ok"
                detail={`محیط اجرا: ${health.environment}`}
              />
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
