import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SelectionBar } from '../components/market/SelectionBar';
import { TradingViewChart } from '../components/market/TradingViewChart';
import { Badge, DataModeBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { ErrorState, Skeleton } from '../components/ui/Feedback';
import { ExternalIcon, InfoIcon, SparkIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { useFormat, useSettings } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks/useApi';
import { useDefaultSelection } from '../lib/hooks/useDefaultSelection';
import { useSelection } from '../lib/hooks/useSelection';
import { TIMEFRAME_LABELS } from '../lib/format';

/**
 * Market Analysis.
 *
 * Owns the TradingView Advanced Chart embed. Everything else on the page exists
 * to make one distinction obvious: the chart is a *visual* integration, while
 * the analysis engine reads candles from the backend market-data service. The
 * data panel below the chart shows exactly what that service returned.
 */
export function MarketAnalysisPage(): JSX.Element {
  const defaults = useDefaultSelection();
  const { selection, setSymbol, setAssetClass, setTimeframe } = useSelection(defaults);
  const { settings } = useSettings();
  const { bootstrap, isDemo } = useSystem();
  const format = useFormat();
  const [chartNote, setChartNote] = useState<string | null>(null);

  const effectiveSymbol = selection.symbol ?? defaults.symbol ?? 'BINANCE:BTCUSDT';

  const candles = useApi(
    effectiveSymbol
      ? (signal) =>
          api.candles(
            {
              symbol: effectiveSymbol,
              assetClass: selection.assetClass,
              timeframe: selection.timeframe,
              limit: 120,
            },
            signal,
          )
      : null,
    [effectiveSymbol, selection.assetClass, selection.timeframe],
  );

  const series = candles.data?.data ?? null;
  const lastCandle = series?.candles[series.candles.length - 1] ?? null;
  const firstCandle = series?.candles[0] ?? null;
  const change =
    lastCandle && firstCandle && firstCandle.close !== 0
      ? ((lastCandle.close - firstCandle.close) / Math.abs(firstCandle.close)) * 100
      : null;

  return (
    <div>
      <PageHeader
        title="تحلیل بازار"
        description="نماد، کلاس دارایی و تایم‌فریم را انتخاب کنید تا نمودار و داده‌ی موتور تحلیل به‌روزرسانی شود."
        badges={
          <>
            {isDemo ? <DataModeBadge mode="demo" /> : <Badge tone="bull" dot>داده واقعی</Badge>}
            <Badge tone="neutral">TradingView Advanced Chart</Badge>
          </>
        }
        actions={
          <Link
            to={`/ai-analysis?symbol=${encodeURIComponent(effectiveSymbol)}&assetClass=${selection.assetClass}&timeframe=${selection.timeframe}`}
            className="nx-btn-primary text-xs"
          >
            <SparkIcon width={14} height={14} />
            تحلیل هوشمند این نماد
          </Link>
        }
      />

      <SelectionBar
        assetClass={selection.assetClass}
        timeframe={selection.timeframe}
        symbol={selection.symbol ?? defaults.symbol}
        onAssetClassChange={setAssetClass}
        onTimeframeChange={setTimeframe}
        onSymbolChange={(market) => {
          setAssetClass(market.assetClass);
          setSymbol(market.symbol);
        }}
        hint="تغییر هر پارامتر، هم نمودار و هم پنل داده زیر آن را به‌روزرسانی می‌کند."
      />

      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <Card>
          <CardHeader
            title="نمودار قیمت"
            description={`${TIMEFRAME_LABELS[selection.timeframe]} · ${effectiveSymbol}`}
            actions={
              <Badge tone="info" title="نمودار TradingView فقط برای نمایش است و منبع داده موتور تحلیل نیست.">
                نمایشی
              </Badge>
            }
          />
          <CardBody>
            <TradingViewChart
              symbol={effectiveSymbol}
              timeframe={selection.timeframe}
              theme={settings.theme}
              height={520}
              {...(chartNote ? { onUnavailable: setChartNote } : {})}
            />

            {chartNote ? (
              <p className="mt-3 text-2xs leading-6 text-warn">{chartNote}</p>
            ) : null}

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-base-900/50 px-3 py-2.5">
              <InfoIcon width={15} height={15} className="mt-0.5 shrink-0 text-ink-subtle" />
              <p className="text-2xs leading-6 text-ink-muted">
                نمودار بالا از ویجت رسمی TradingView استفاده می‌کند و تنها برای مشاهده است. موتور تحلیل
                پایتون هیچ داده‌ای از این ویجت نمی‌خواند؛ کندل‌ها از سرویس داده سرور نکسورا تأمین
                می‌شوند (پنل زیر).
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="داده‌ی موتور تحلیل"
            description="این همان داده‌ای است که به موتور تحلیل پایتون داده می‌شود."
            actions={
              <>
                {series ? <DataModeBadge mode={series.source.mode} /> : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={candles.reload}
                  loading={candles.refreshing}
                  aria-label="به‌روزرسانی داده"
                >
                  به‌روزرسانی
                </Button>
              </>
            }
          />
          <CardBody>
            {candles.loading ? (
              <Skeleton lines={4} />
            ) : candles.error ? (
              <ErrorState error={candles.error} onRetry={candles.reload} />
            ) : !series || series.candles.length === 0 ? (
              <p className="text-2xs text-ink-muted">
                سرویس داده برای این نماد و تایم‌فریم کندلی برنگرداند. نماد یا تایم‌فریم دیگری را امتحان
                کنید.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="منبع داده" value={series.source.provider} mono />
                <Metric
                  label="تعداد کندل دریافتی"
                  value={format.integer(series.candles.length)}
                />
                <Metric
                  label="قیمت آخرین کندل"
                  value={lastCandle ? format.number(lastCandle.close) : '—'}
                  tone={(change ?? 0) > 0 ? 'text-bull' : (change ?? 0) < 0 ? 'text-bear' : 'text-ink'}
                />
                <Metric
                  label="تغییر بازه ۱۲۰ کندل"
                  value={change === null ? '—' : format.percent(change)}
                  tone={(change ?? 0) > 0 ? 'text-bull' : (change ?? 0) < 0 ? 'text-bear' : 'text-ink-muted'}
                />
                <Metric
                  label="زمان آخرین کندل"
                  value={lastCandle ? format.dateTime(new Date(lastCandle.time).toISOString()) : '—'}
                />
                <Metric
                  label="زمان دریافت"
                  value={format.dateTime(series.source.fetchedAt)}
                />
                <Metric label="نماد TradingView" value={series.tvSymbol} mono />
                <Metric label="تایم‌فریم" value={TIMEFRAME_LABELS[series.timeframe]} />
              </div>
            )}

            {series?.source.mode === 'demo' ? (
              <p className="mt-4 rounded-lg border border-warn/35 bg-warn/[0.07] px-3 py-2.5 text-2xs leading-6 text-ink-muted">
                داده‌های این پنل دمو و ساختگی هستند و قیمت واقعی بازار نیستند. برای داده واقعی، متغیر
                <span className="ltr-data"> MARKET_DATA_PROVIDER </span>
                را در فایل <span className="ltr-data">.env</span> تنظیم کنید.
                {bootstrap && !bootstrap.marketData.supports.includes('forex') ? (
                  <span>
                    {' '}
                    منبع داده فعلی فقط کلاس‌های{' '}
                    <span className="ltr-data">{bootstrap.marketData.supports.join(', ') || '—'}</span> را
                    پشتیبانی می‌کند.
                  </span>
                ) : null}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card className="nx-card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-2xs leading-6 text-ink-muted">
              برای مشاهده این نماد در سایت TradingView (خارج از نکسورا) از لینک زیر استفاده کنید.
            </p>
            <a
              className="nx-btn-secondary text-xs"
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(effectiveSymbol)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              باز کردن در TradingView
              <ExternalIcon width={14} height={14} />
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'text-ink',
  mono = false,
}: {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-base-900/40 p-3">
      <p className="text-2xs text-ink-subtle">{label}</p>
      <p className={`mt-1 truncate text-xs ${mono ? 'ltr-data' : 'num'} ${tone}`}>{value}</p>
    </div>
  );
}
