import { Link } from 'react-router-dom';
import { useFormat } from '../../context/SettingsContext';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks/useApi';
import { ASSET_CLASS_LABELS, TIMEFRAME_LABELS, TREND_LABELS } from '../../lib/format';
import { AnalysisStatusBadge, Badge, DataModeBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState, ErrorState, TableSkeleton } from '../ui/Feedback';
import { RefreshIcon, SparkIcon } from '../ui/Icons';

/**
 * Recent reports.
 *
 * Reads the persisted history rather than session state, so it reflects what
 * will still be there after a restart — and each row links to the full report.
 */
export function RecentReportsList({ limit = 5 }: { limit?: number }): JSX.Element {
  const format = useFormat();
  const state = useApi((signal) => api.history({ limit }, signal).then((result) => result), [limit]);

  const items = state.data?.data.items ?? [];
  const persistent = state.data?.meta.persistent ?? false;

  return (
    <Card>
      <CardHeader
        title="آخرین گزارش‌های تحلیل"
        description="گزارش‌های ذخیره‌شده در سمت سرور، از جدید به قدیم."
        actions={
          <>
            {state.data && !persistent ? (
              <Badge tone="warn" title="ذخیره‌سازی پایدار در سرور فعال نیست.">
                بدون ذخیره‌سازی پایدار
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={state.reload}
              loading={state.refreshing}
              aria-label="به‌روزرسانی گزارش‌ها"
            >
              <RefreshIcon width={14} height={14} />
              <span className="text-2xs">به‌روزرسانی</span>
            </Button>
          </>
        }
      />
      <CardBody>
        {state.loading ? (
          <TableSkeleton rows={3} columns={4} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<SparkIcon width={22} height={22} />}
            title="هنوز گزارشی ثبت نشده است"
            description="در صفحه «تحلیل هوشمند» یک نماد را انتخاب کنید و تحلیل را اجرا کنید تا اولین گزارش ساخته شود."
            action={
              <Link to="/ai-analysis" className="nx-btn-primary text-xs">
                <SparkIcon width={14} height={14} />
                اجرای تحلیل
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/history?report=${encodeURIComponent(item.id)}`}
                      className="truncate text-xs font-medium text-ink transition hover:text-accent"
                    >
                      {item.name}
                    </Link>
                    <AnalysisStatusBadge status={item.status} />
                    <DataModeBadge mode={item.mode} />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-subtle">
                    <span className="ltr-data">{item.symbol}</span>
                    <span>·</span>
                    <span>{TIMEFRAME_LABELS[item.timeframe]}</span>
                    <span>·</span>
                    <span>{ASSET_CLASS_LABELS[item.assetClass]}</span>
                    <span>·</span>
                    <span>{format.relative(item.createdAt)}</span>
                  </p>
                </div>

                <div className="flex items-center gap-4 text-end">
                  <div>
                    <p className="num text-xs text-ink">
                      {item.price === null ? '—' : format.number(item.price)}
                    </p>
                    <p className="text-2xs text-ink-subtle">
                      {item.trendDirection ? TREND_LABELS[item.trendDirection] ?? item.trendDirection : 'نامشخص'}
                    </p>
                  </div>
                  <Link
                    to={`/history?report=${encodeURIComponent(item.id)}`}
                    className="nx-btn-ghost px-2 py-1 text-2xs"
                  >
                    مشاهده
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
