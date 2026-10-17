import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFormat, useSettings } from '../../context/SettingsContext';
import { ApiError, api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useApi } from '../../lib/hooks/useApi';
import { ASSET_CLASS_LABELS, TIMEFRAME_LABELS, toneForChange } from '../../lib/format';
import type { AssetClass, Timeframe } from '../../types/nexora';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState, ErrorState, TableSkeleton } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { ClockIcon, RefreshIcon, SparkIcon } from '../ui/Icons';

export interface OverviewSymbol {
  symbol: string;
  name: string;
  tvSymbol: string;
  assetClass: AssetClass;
}

interface OverviewRow extends OverviewSymbol {
  price: number | null;
  changePercent: number | null;
  candleTime: number | null;
  /** Per-symbol failure message; one bad symbol must not break the table. */
  error: string | null;
}

/**
 * Market overview.
 *
 * Derived from the same `/api/market-data` endpoint the analysis engine uses —
 * not from the TradingView widget and not from invented prices. Values are the
 * last close and the change across the fetched window, computed here from the
 * returned candles. Each symbol is requested independently so a single failure
 * degrades one row rather than the whole table.
 */
export function MarketOverviewTable({
  symbols,
  timeframe,
  caption,
}: {
  symbols: OverviewSymbol[];
  timeframe: Timeframe;
  caption?: string;
}): JSX.Element {
  const format = useFormat();
  const { settings } = useSettings();

  const key = useMemo(
    () => symbols.map((item) => item.symbol).join(','),
    [symbols],
  );

  const state = useApi(
    symbols.length === 0
      ? null
      : async (signal) => {
          const settled = await Promise.allSettled(
            symbols.map((item) =>
              api.candles(
                { symbol: item.symbol, assetClass: item.assetClass, timeframe, limit: 60 },
                signal,
              ),
            ),
          );

          return settled.map<OverviewRow>((outcome, index) => {
            const base = symbols[index] as OverviewSymbol;
            if (outcome.status === 'rejected') {
              const reason = outcome.reason;
              return {
                ...base,
                price: null,
                changePercent: null,
                candleTime: null,
                error:
                  reason instanceof ApiError ? reason.message : 'دریافت داده این نماد ناموفق بود.',
              };
            }

            const series = outcome.value.data;
            const candles = series.candles;
            const last = candles[candles.length - 1] ?? null;
            const first = candles[0] ?? null;
            const changePercent =
              last && first && first.close !== 0
                ? ((last.close - first.close) / Math.abs(first.close)) * 100
                : null;

            return {
              ...base,
              price: last?.close ?? null,
              changePercent,
              candleTime: last?.time ?? null,
              error: null,
            };
          });
        },
    [key, timeframe],
  );

  const rows = state.data ?? [];

  return (
    <Card>
      <CardHeader
        title="نمای کلی بازار"
        description={
          caption ??
          `قیمت آخرین کندل و تغییر در بازه ${TIMEFRAME_LABELS[timeframe]} — محاسبه‌شده از داده سرویس تحلیل.`
        }
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={state.reload}
            loading={state.refreshing}
            aria-label="به‌روزرسانی نمای کلی بازار"
          >
            <RefreshIcon width={14} height={14} />
            <span className="text-2xs">به‌روزرسانی</span>
          </Button>
        }
      />

      <CardBody>
        {symbols.length === 0 ? (
          <EmptyState
            title="نمادی برای نمایش نیست"
            description="نمادهایی به واچ‌لیست اضافه کنید تا در این جدول نمایش داده شوند."
            action={
              <Link to="/watchlist" className="nx-btn-secondary text-xs">
                رفتن به واچ‌لیست
              </Link>
            }
          />
        ) : state.loading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="nx-table min-w-[46rem]">
              <caption className="sr-only">نمای کلی بازار</caption>
              <thead>
                <tr>
                  <th scope="col">نماد</th>
                  <th scope="col">کلاس</th>
                  <th scope="col">قیمت آخرین کندل</th>
                  <th scope="col">تغییر بازه</th>
                  <th scope="col">کندل</th>
                  <th scope="col">عملیات</th>
                </tr>
              </thead>
              <tbody className={settings.compactTables ? '[&_td]:py-1.5' : undefined}>
                {rows.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-ink">{row.name}</p>
                        <p className="ltr-data truncate text-2xs text-ink-subtle">{row.symbol}</p>
                      </div>
                    </td>
                    <td className="text-2xs text-ink-muted">{ASSET_CLASS_LABELS[row.assetClass]}</td>
                    <td className="num">
                      {row.error ? (
                        <span className="text-2xs text-bear" title={row.error}>
                          خطا
                        </span>
                      ) : row.price === null ? (
                        '—'
                      ) : (
                        <span className="text-ink">{format.number(row.price)}</span>
                      )}
                    </td>
                    <td className={cn('num', toneForChange(row.changePercent))}>
                      {row.changePercent === null ? '—' : format.percent(row.changePercent)}
                    </td>
                    <td className="whitespace-nowrap">
                      {row.candleTime ? (
                        <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
                          <ClockIcon width={12} height={12} />
                          {format.relative(new Date(row.candleTime).toISOString())}
                        </span>
                      ) : (
                        <span className="text-2xs text-ink-subtle">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/market?symbol=${encodeURIComponent(row.symbol)}&assetClass=${row.assetClass}&timeframe=${timeframe}`}
                          className="nx-btn-ghost px-2 py-1 text-2xs"
                        >
                          نمودار
                        </Link>
                        <Link
                          to={`/ai-analysis?symbol=${encodeURIComponent(row.symbol)}&assetClass=${row.assetClass}&timeframe=${timeframe}`}
                          className="nx-btn-ghost px-2 py-1 text-2xs"
                        >
                          <SparkIcon width={13} height={13} />
                          تحلیل
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
