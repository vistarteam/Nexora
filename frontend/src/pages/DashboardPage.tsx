import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ConnectionPanel } from '../components/dashboard/ConnectionPanel';
import { RecentReportsList } from '../components/dashboard/RecentReportsList';
import { MarketOverviewTable, type OverviewSymbol } from '../components/market/MarketOverviewTable';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { SparkIcon, StarIcon } from '../components/ui/Icons';
import { useFormat } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { useWatchlist } from '../context/WatchlistContext';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks/useApi';
import { useDefaultSelection } from '../lib/hooks/useDefaultSelection';
import { ASSET_CLASS_LABELS, TIMEFRAME_LABELS } from '../lib/format';

/**
 * Dashboard.
 *
 * Composes four independent blocks (status tiles, market overview, recent
 * reports, service health). Each block owns its own loading, empty and error
 * state, so a failure in one does not blank the page.
 */
export function DashboardPage(): JSX.Element {
  const { bootstrap, health } = useSystem();
  const { items: watchlist, loading: watchlistLoading } = useWatchlist();
  const defaults = useDefaultSelection();
  const format = useFormat();

  // One catalog fetch resolves display names for any symbol we show.
  const catalog = useApi((signal) => api.markets({}, signal).then((result) => result.data), []);
  const historyTotals = useApi((signal) => api.history({ limit: 1 }, signal).then((result) => result.data), []);

  const overviewSymbols = useMemo<OverviewSymbol[]>(() => {
    const bySymbol = new Map((catalog.data?.items ?? []).map((item) => [item.symbol, item]));

    if (watchlist.length > 0) {
      return watchlist.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        tvSymbol: item.tvSymbol,
        assetClass: item.assetClass,
      }));
    }

    // With an empty watchlist, show the instrument the app opens on, so the
    // dashboard is never blank on first run.
    if (!defaults.symbol) return [];
    const known = bySymbol.get(defaults.symbol);
    return [
      {
        symbol: defaults.symbol,
        name: known?.name ?? defaults.symbol,
        tvSymbol: known?.tvSymbol ?? defaults.symbol,
        assetClass: defaults.assetClass,
      },
    ];
  }, [catalog.data, defaults.assetClass, defaults.symbol, watchlist]);

  const reportsTotal = historyTotals.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="داشبورد"
        description="نمای کلی وضعیت بازار، واچ‌لیست و آخرین تحلیل‌های تولیدشده."
        badges={
          <>
            <Badge tone="bull" dot>داده واقعی</Badge>
            <Badge tone="neutral">
              تایم‌فریم پیش‌فرض: {TIMEFRAME_LABELS[defaults.timeframe]}
            </Badge>
          </>
        }
        actions={
          <>
            <Link to="/market" className="nx-btn-secondary text-xs">
              تحلیل بازار
            </Link>
            <Link to="/ai-analysis" className="nx-btn-primary text-xs">
              <SparkIcon width={14} height={14} />
              تحلیل هوشمند
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="وضعیت اتصال بازار"
          value={health ? 'متصل' : 'نامشخص'}
          tone={health ? 'text-bull' : 'text-ink-muted'}
          hint={
            bootstrap
              ? `منبع: ${bootstrap.marketData.label}`
              : 'در حال دریافت تنظیمات سرویس…'
          }
          loading={!bootstrap}
          trailing={<span aria-hidden="true" className={`h-2 w-2 rounded-full ${health ? 'bg-bull' : 'bg-ink-subtle'}`} />}
        />

        <StatCard
          label="نمادهای واچ‌لیست"
          value={format.integer(watchlist.length)}
          hint="برای مدیریت به صفحه واچ‌لیست بروید."
          loading={watchlistLoading}
          trailing={<StarIcon width={15} height={15} className="text-ink-subtle" />}
        />

        <StatCard
          label="گزارش‌های ذخیره‌شده"
          value={format.integer(reportsTotal)}
          hint={
            bootstrap?.storage.persistent
              ? `ذخیره‌سازی ${bootstrap.storage.driver} فعال است.`
              : 'ذخیره‌سازی پایدار فعال نیست.'
          }
          tone={bootstrap?.storage.persistent ? 'text-ink' : 'text-warn'}
          loading={historyTotals.loading}
        />

        <StatCard
          label="موتور تحلیل"
          value={
            health
              ? health.checks.analysisEngine.status === 'available'
                ? 'پایتون'
                : 'جایگزین'
              : '—'
          }
          hint={
            health?.checks.analysisEngine.status === 'available'
              ? 'موتور اصلی در دسترس است.'
              : 'در صورت فعال بودن، پیاده‌سازی جایگزین استفاده می‌شود.'
          }
          tone={health?.checks.analysisEngine.status === 'available' ? 'text-accent' : 'text-warn'}
          loading={!health}
        />
      </div>

      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <MarketOverviewTable
          symbols={overviewSymbols}
          timeframe={defaults.timeframe}
          caption={
            watchlist.length > 0
              ? 'قیمت آخرین کندل و تغییر بازه برای نمادهای واچ‌لیست.'
              : 'نمادهای واچ‌لیست خالی است؛ نماد پیش‌فرض نمایش داده می‌شود.'
          }
        />

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
          <RecentReportsList limit={5} />
          <ConnectionPanel />
        </div>

        {catalog.error ? (
          <p className="text-2xs text-bear">
            دریافت فهرست نمادها ناموفق بود؛ نام برخی نمادها ممکن است نمایش داده نشود.
          </p>
        ) : null}

        <p className="text-2xs leading-6 text-ink-subtle">
          اطلاعات این صفحه از سرویس داده‌ی سرور نکسورا محاسبه می‌شود. نمودار TradingView در صفحه
          «تحلیل بازار» صرفاً برای نمایش است و داده‌ای به موتور تحلیل نمی‌دهد.
          {watchlist.length > 0
            ? ` نمادهای فعال: ${watchlist
                .slice(0, 4)
                .map((item) => `${item.name} (${ASSET_CLASS_LABELS[item.assetClass]})`)
                .join('، ')}`
            : ''}
        </p>
      </div>
    </div>
  );
}
