import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ReportView } from '../components/analysis/ReportView';
import { AnalysisStatusBadge, Badge, DataModeBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '../components/ui/Feedback';
import { ClockIcon, SparkIcon, TrashIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { useFormat } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useApi } from '../lib/hooks/useApi';
import { ENGINE_LABELS, TIMEFRAME_LABELS, TREND_LABELS } from '../lib/format';

/**
 * Analysis history.
 *
 * Reports are persisted server-side, so this page reflects real durability: if
 * the backend is running on the in-memory storage driver, the page says so
 * rather than implying the data is safe.
 */
export function HistoryPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('report');
  const [limit, setLimit] = useState(20);
  const { storagePersistent, bootstrap } = useSystem();
  const { success, error: errorToast } = useToast();
  const format = useFormat();

  const list = useApi(
    (signal) => api.history({ limit }, signal).then((result) => result),
    [limit],
  );

  const detail = useApi(
    selectedId ? (signal) => api.report(selectedId, signal).then((result) => result.data.report) : null,
    [selectedId],
  );

  const items = list.data?.data.items ?? [];
  const total = list.data?.data.total ?? 0;
  const persistent = list.data?.meta.persistent ?? storagePersistent;

  const select = (id: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('report', id);
    else next.delete('report');
    setSearchParams(next, { replace: true });
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteReport(id);
      success('گزارش حذف شد.');
      if (selectedId === id) select(null);
      list.reload();
    } catch (caught) {
      errorToast(caught instanceof Error ? caught.message : 'حذف گزارش ناموفق بود.');
    }
  };

  const hasMore = useMemo(() => items.length < total, [items.length, total]);

  return (
    <div>
      <PageHeader
        title="تاریخچه تحلیل"
        description="گزارش‌های تحلیل ذخیره‌شده در سرور، با امکان مشاهده کامل و حذف."
        badges={
          <>
            <Badge tone="neutral">{format.integer(total)} گزارش</Badge>
            {persistent ? (
              <Badge tone="accent" dot>
                ذخیره‌سازی پایدار
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                ذخیره‌سازی غیرپایدار
              </Badge>
            )}
          </>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={list.reload} loading={list.refreshing}>
            به‌روزرسانی
          </Button>
        }
      />

      {!persistent ? (
        <div className="mb-4 rounded-lg border border-warn/35 bg-warn/[0.07] px-3.5 py-2.5">
          <p className="text-2xs leading-6 text-ink-muted">
            <span className="font-semibold text-warn">محدودیت ذخیره‌سازی: </span>
            سرور با درایور <span className="ltr-data">{bootstrap?.storage.driver ?? 'memory'}</span>{' '}
            اجرا می‌شود و داده‌ها پس از راه‌اندازی مجدد از دست می‌روند. برای ذخیره‌سازی پایدار، مقادیر{' '}
            <span className="ltr-data">STORAGE_DRIVER=json</span> و در ادامه یک درایور PostgreSQL را
            تنظیم کنید.
          </p>
        </div>
      ) : null}

      <div className="space-y-4 sm:space-y-5">
        <Card>
          <CardHeader
            title="گزارش‌های ذخیره‌شده"
            description="برای مشاهده جزئیات، روی گزارش کلیک کنید."
            actions={hasMore ? <Badge tone="neutral">نمایش {format.integer(items.length)} از {format.integer(total)}</Badge> : null}
          />
          <CardBody>
            {list.loading && items.length === 0 ? (
              <TableSkeleton rows={5} columns={5} />
            ) : list.error && items.length === 0 ? (
              <ErrorState error={list.error} onRetry={list.reload} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<ClockIcon width={22} height={22} />}
                title="تاریخچه خالی است"
                description="هر تحلیل اجراشده به‌صورت خودکار ذخیره می‌شود. اولین تحلیل خود را در صفحه «تحلیل هوشمند» اجرا کنید."
                action={
                  <Link to="/ai-analysis" className="nx-btn-primary text-xs">
                    <SparkIcon width={14} height={14} />
                    اجرای تحلیل
                  </Link>
                }
              />
            ) : (
              <>
                <div className="-mx-4 overflow-x-auto sm:-mx-5">
                  <table className="nx-table min-w-[52rem]">
                    <caption className="sr-only">گزارش‌های تحلیل</caption>
                    <thead>
                      <tr>
                        <th scope="col">نماد</th>
                        <th scope="col">تایم‌فریم</th>
                        <th scope="col">وضعیت</th>
                        <th scope="col">روند</th>
                        <th scope="col">قیمت</th>
                        <th scope="col">موتور</th>
                        <th scope="col">زمان</th>
                        <th scope="col">عملیات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className={cn(selectedId === item.id && 'bg-accent/[0.06]')}
                        >
                          <td>
                            <button
                              type="button"
                              onClick={() => select(item.id)}
                              className="min-w-0 text-start"
                            >
                              <span className="block truncate text-xs text-ink transition hover:text-accent">
                                {item.name}
                              </span>
                              <span className="ltr-data block truncate text-2xs text-ink-subtle">
                                {item.symbol}
                              </span>
                            </button>
                          </td>
                          <td className="whitespace-nowrap text-2xs text-ink-muted">
                            {TIMEFRAME_LABELS[item.timeframe]}
                          </td>
                          <td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <AnalysisStatusBadge status={item.status} />
                              <DataModeBadge mode={item.mode} />
                            </div>
                          </td>
                          <td className="text-2xs text-ink-muted">
                            {item.trendDirection
                              ? TREND_LABELS[item.trendDirection] ?? item.trendDirection
                              : '—'}
                          </td>
                          <td className="num text-xs text-ink">
                            {item.price === null ? '—' : format.number(item.price)}
                          </td>
                          <td className="text-2xs text-ink-subtle">
                            {ENGINE_LABELS[item.engine] ?? item.engine}
                          </td>
                          <td className="whitespace-nowrap text-2xs text-ink-muted">
                            {format.relative(item.createdAt)}
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="px-2 py-1 text-2xs"
                                onClick={() => select(item.id)}
                              >
                                مشاهده
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="px-2 py-1 text-2xs text-bear hover:bg-bear/10"
                                onClick={() => void remove(item.id)}
                                aria-label={`حذف گزارش ${item.name}`}
                              >
                                <TrashIcon width={13} height={13} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {hasMore ? (
                  <div className="mt-4 flex justify-center">
                    <Button variant="secondary" size="sm" onClick={() => setLimit((value) => value + 20)}>
                      نمایش گزارش‌های بیشتر
                    </Button>
                  </div>
                ) : null}

                {list.error && items.length > 0 ? (
                  <div className="mt-4">
                    <ErrorState
                      error={list.error}
                      onRetry={list.reload}
                      title="به‌روزرسانی فهرست ناموفق بود"
                    />
                  </div>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="جزئیات گزارش"
            description={
              selectedId
                ? 'گزارش انتخاب‌شده، شامل داده محاسبه‌شده، تفسیر و سناریوها.'
                : 'هنوز گزارشی انتخاب نشده است.'
            }
            actions={
              selectedId ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={detail.reload}
                    loading={detail.refreshing}
                  >
                    به‌روزرسانی
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => select(null)}>
                    بستن
                  </Button>
                </>
              ) : null
            }
          />
          <CardBody>
            {!selectedId ? (
              <EmptyState
                title="گزارشی انتخاب نشده است"
                description="از جدول بالا یک گزارش را انتخاب کنید تا جزئیات کامل آن نمایش داده شود."
              />
            ) : detail.loading ? (
              <div className="space-y-4">
                <Skeleton lines={3} />
                <Skeleton lines={6} />
              </div>
            ) : detail.error ? (
              <ErrorState error={detail.error} onRetry={detail.reload} />
            ) : detail.data ? (
              <ReportView report={detail.data} />
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
