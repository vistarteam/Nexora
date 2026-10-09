import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SymbolPicker } from '../components/market/SymbolPicker';
import { Badge, DataModeBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/Feedback';
import { ChartIcon, PlusIcon, SparkIcon, StarIcon, TrashIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { useFormat } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { useToast } from '../context/ToastContext';
import { useWatchlist } from '../context/WatchlistContext';
import { cn } from '../lib/cn';
import { ASSET_CLASS_LABELS } from '../lib/format';
import { ASSET_CLASSES, type AssetClass } from '../types/nexora';

/**
 * Watchlist.
 *
 * The durable copy lives on the server; a local cache keeps the list visible
 * while offline or during a slow request. When the displayed list is the cached
 * one, the page says so rather than pretending it is in sync.
 */
export function WatchlistPage(): JSX.Element {
  const { items, loading, error, stale, reload, add, remove, pendingSymbols } = useWatchlist();
  const { bootstrap, storagePersistent } = useSystem();
  const { success, error: errorToast } = useToast();
  const format = useFormat();

  const [assetClass, setAssetClass] = useState<AssetClass>('crypto');
  const [pendingSelection, setPendingSelection] = useState<{ symbol: string; name: string } | null>(null);

  const handleAdd = async (): Promise<void> => {
    if (!pendingSelection) return;
    const ok = await add(pendingSelection.symbol, assetClass);
    if (ok) {
      success(`${pendingSelection.name} به واچ‌لیست اضافه شد.`);
      setPendingSelection(null);
    } else {
      errorToast('افزودن نماد ناموفق بود.');
    }
  };

  const handleRemove = async (symbol: string, name: string): Promise<void> => {
    const ok = await remove(symbol);
    if (ok) success(`${name} از واچ‌لیست حذف شد.`);
    else errorToast('حذف نماد ناموفق بود.');
  };

  return (
    <div>
      <PageHeader
        title="واچ‌لیست"
        description="نمادهای منتخب شما. این لیست در سرور ذخیره می‌شود و نسخه محلی آن برای نمایش سریع و کار در حالت قطعی نگهداری می‌شود."
        badges={
          <>
            <Badge tone="neutral">{format.integer(items.length)} نماد</Badge>
            {storagePersistent ? (
              <Badge tone="accent" dot>
                ذخیره‌سازی پایدار
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                ذخیره‌سازی غیرپایدار
              </Badge>
            )}
            {stale ? <Badge tone="warn">نمایش از حافظه محلی</Badge> : null}
          </>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => void reload()} loading={loading}>
            به‌روزرسانی
          </Button>
        }
      />

      <div className="space-y-4 sm:space-y-5">
        <Card>
          <CardHeader
            title="افزودن نماد"
            description="نماد را جست‌وجو کنید، کلاس دارایی را انتخاب و به لیست اضافه کنید."
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_auto] lg:items-end">
              <div className="grid gap-4 sm:grid-cols-2">
                <SymbolPicker
                  value={pendingSelection?.symbol ?? null}
                  assetClass={assetClass}
                  onSelect={(market) =>
                    setPendingSelection({ symbol: market.symbol, name: market.name })
                  }
                  label="جست‌وجوی نماد"
                />
                <div>
                  <span className="nx-label">کلاس دارایی</span>
                  <SegmentedControl<AssetClass>
                    ariaLabel="کلاس دارایی نماد جدید"
                    value={assetClass}
                    onChange={(value) => {
                      setAssetClass(value);
                      setPendingSelection(null);
                    }}
                    options={ASSET_CLASSES.map((item) => ({
                      value: item,
                      label: ASSET_CLASS_LABELS[item],
                    }))}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                onClick={() => void handleAdd()}
                disabled={!pendingSelection}
                icon={<PlusIcon width={15} height={15} />}
              >
                افزودن به واچ‌لیست
              </Button>
            </div>

            {!pendingSelection ? (
              <p className="text-2xs text-ink-subtle">
                برای فعال شدن دکمه افزودن، ابتدا یک نماد را از فهرست انتخاب کنید.
              </p>
            ) : (
              <p className="text-2xs text-ink-subtle">
                انتخاب فعلی: <span className="text-ink">{pendingSelection.name}</span>{' '}
                <span className="ltr-data">{pendingSelection.symbol}</span>
              </p>
            )}

            {bootstrap && !storagePersistent ? (
              <p className="rounded-lg border border-warn/35 bg-warn/[0.07] px-3 py-2.5 text-2xs leading-6 text-ink-muted">
                ذخیره‌سازی سرور در حالت پایدار نیست ({bootstrap.storage.driver})؛ با راه‌اندازی مجدد
                سرور این لیست خالی می‌شود. برای ذخیره‌سازی پایدار، مقدار{' '}
                <span className="ltr-data">STORAGE_DRIVER=json</span> را تنظیم کنید.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="نمادهای منتخب"
            description="از هر ردیف می‌توانید نمودار یا تحلیل هوشمند همان نماد را باز کنید."
            actions={stale ? <Badge tone="warn">داده‌ها ممکن است قدیمی باشند</Badge> : null}
          />
          <CardBody>
            {loading && items.length === 0 ? (
              <TableSkeleton rows={4} columns={4} />
            ) : error && items.length === 0 ? (
              <ErrorState error={error} onRetry={() => void reload()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<StarIcon width={22} height={22} />}
                title="واچ‌لیست خالی است"
                description="نمادهای مورد نظر خود را اضافه کنید تا در داشبورد و نمای کلی بازار نمایش داده شوند."
              />
            ) : (
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="nx-table min-w-[44rem]">
                  <caption className="sr-only">نمادهای واچ‌لیست</caption>
                  <thead>
                    <tr>
                      <th scope="col">نماد</th>
                      <th scope="col">کلاس دارایی</th>
                      <th scope="col">تاریخ افزودن</th>
                      <th scope="col">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const busy = pendingSymbols.includes(item.symbol.toUpperCase());
                      return (
                        <tr key={item.symbol} className={cn(busy && 'opacity-60')}>
                          <td>
                            <div className="min-w-0">
                              <p className="truncate text-xs text-ink">{item.name}</p>
                              <p className="ltr-data truncate text-2xs text-ink-subtle">{item.symbol}</p>
                            </div>
                          </td>
                          <td className="text-2xs text-ink-muted">
                            {ASSET_CLASS_LABELS[item.assetClass]}
                          </td>
                          <td className="num text-2xs text-ink-muted">
                            {format.dateTime(item.addedAt)}
                          </td>
                          <td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                to={`/market?symbol=${encodeURIComponent(item.symbol)}&assetClass=${item.assetClass}`}
                                className="nx-btn-ghost px-2 py-1 text-2xs"
                              >
                                <ChartIcon width={13} height={13} />
                                نمودار
                              </Link>
                              <Link
                                to={`/ai-analysis?symbol=${encodeURIComponent(item.symbol)}&assetClass=${item.assetClass}`}
                                className="nx-btn-ghost px-2 py-1 text-2xs"
                              >
                                <SparkIcon width={13} height={13} />
                                تحلیل
                              </Link>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="px-2 py-1 text-2xs text-bear hover:bg-bear/10"
                                loading={busy}
                                onClick={() => void handleRemove(item.symbol, item.name)}
                                aria-label={`حذف ${item.name} از واچ‌لیست`}
                              >
                                <TrashIcon width={13} height={13} />
                                حذف
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {error && items.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-2xs text-warn">
                  آخرین به‌روزرسانی سرور ناموفق بود؛ لیست زیر از حافظه محلی خوانده شده است.
                </p>
                <ErrorState error={error} onRetry={() => void reload()} />
              </div>
            ) : null}
          </CardBody>
        </Card>

        {bootstrap ? (
          <p className="text-2xs leading-6 text-ink-subtle">
            منبع داده فعلی: <span className="text-ink-muted">{bootstrap.marketData.label}</span>
            {bootstrap.marketData.isDemo ? ' (دمو — قیمت واقعی نیست)' : ''} · وضعیت داده:{' '}
            <DataModeBadge mode={bootstrap.marketData.isDemo ? 'demo' : 'live'} />
          </p>
        ) : null}
      </div>
    </div>
  );
}
