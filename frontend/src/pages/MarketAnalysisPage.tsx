import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnalysisChart } from '../components/chart/AnalysisChart';
import { SelectionBar } from '../components/market/SelectionBar';
import { TradingViewChart } from '../components/market/TradingViewChart';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { ErrorState, Skeleton } from '../components/ui/Feedback';
import { ExternalIcon, SparkIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Toggle } from '../components/ui/Field';
import { useFormat, useSettings } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { api } from '../lib/api';
import { windowChangePercent } from '../lib/chart';
import { useApi } from '../lib/hooks/useApi';
import { useDefaultSelection } from '../lib/hooks/useDefaultSelection';
import { useLiveTicker } from '../lib/hooks/useLiveTicker';
import { useSelection } from '../lib/hooks/useSelection';
import { ASSET_CLASS_LABELS, TIMEFRAME_LABELS } from '../lib/format';

/**
 * Market Analysis.
 *
 * The chart here is drawn from `/api/chart`: real candles from the configured
 * provider, with the analysis engine's own moving averages, levels, swing points
 * and oscillators on top of them.
 *
 * This replaced a TradingView embed. The embed looked impressive but charted a
 * different venue, at its own interval, with its own indicator settings — so the
 * chart and the analysis described two different markets, and the page carried
 * two candle counts instead of one. A chart the engine did not produce cannot be
 * reconciled with the engine's numbers, which is why it is now optional rather
 * than the default.
 */
export function MarketAnalysisPage(): JSX.Element {
  const defaults = useDefaultSelection();
  const { selection, setSymbol, setAssetClass, setTimeframe } = useSelection(defaults);
  const { settings } = useSettings();
  const { bootstrap } = useSystem();
  const format = useFormat();
  // Shown by default: this is the real TradingView chart — its own live feed and
  // its own indicators — and users expect it on a market page. The engine's chart
  // remains below it, because only that one is reconciled with the report.
  const [showEmbed, setShowEmbed] = useState(true);

  const effectiveSymbol = selection.symbol ?? defaults.symbol ?? 'BINANCE:BTCUSDT';

  const chartState = useApi(
    effectiveSymbol
      ? (signal) =>
          api.chart(
            {
              symbol: effectiveSymbol,
              assetClass: selection.assetClass,
              timeframe: selection.timeframe,
              limit: 300,
            },
            signal,
          )
      : null,
    [effectiveSymbol, selection.assetClass, selection.timeframe],
  );

  const chart = chartState.data?.data ?? null;

  // Kept live once the history has arrived: the whole point of this page is that
  // the price on screen is the price now, not the price when the page opened.
  const live = useLiveTicker(
    {
      symbol: effectiveSymbol,
      assetClass: selection.assetClass,
      timeframe: selection.timeframe,
    },
    { enabled: chart !== null },
  );

  const candles = chart?.candles ?? [];
  const lastCandle = candles[candles.length - 1] ?? null;
  const change = windowChangePercent(candles);

  return (
    <div>
      <PageHeader
        title="تحلیل بازار"
        description="نمودار از داده واقعی سرویس بازار ساخته می‌شود و تحلیل موتور (میانگین‌ها، سطوح، نقاط چرخش و نوسان‌نماها) روی همان نمودار ترسیم می‌شود."
        badges={
          <>
            <Badge tone="bull" dot>داده واقعی</Badge>
            <Badge tone="neutral">تحلیل روی نمودار</Badge>
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
        hint="نمودار و تحلیل هر دو از یک درخواست ساخته می‌شوند؛ بنابراین اعداد روی نمودار با اعداد تحلیل یکی است."
      />

      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <Card>
          <CardHeader
            title="نمودار و تحلیل"
            description={
              chart
                ? `${TIMEFRAME_LABELS[chart.timeframe]} · ${chart.symbol} · ${chart.assetClass}`
                : 'در حال دریافت داده و محاسبه تحلیل…'
            }
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={chartState.reload}
                loading={chartState.refreshing}
                aria-label="به‌روزرسانی نمودار و تحلیل"
              >
                به‌روزرسانی
              </Button>
            }
          />
          <CardBody className="p-0">
            {chartState.loading ? (
              <div className="p-4">
                <Skeleton lines={8} />
              </div>
            ) : chartState.error ? (
              <div className="p-4">
                <ErrorState error={chartState.error} onRetry={chartState.reload} />
              </div>
            ) : chart ? (
              <AnalysisChart chart={chart} height={560} live={live} />
            ) : (
              <p className="p-4 text-2xs text-ink-muted">
                سرویس داده برای این نماد و تایم‌فریم کندلی برنگرداند. نماد یا تایم‌فریم دیگری را امتحان کنید.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="داده‌ی موتور تحلیل"
            description="این همان داده‌ای است که به موتور تحلیل داده می‌شود و نمودار بالا از آن ساخته شده است."
          />
          <CardBody>
            {chartState.loading ? (
              <Skeleton lines={4} />
            ) : !chart ? (
              <p className="text-2xs text-ink-muted">داده‌ای برای نمایش وجود ندارد.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="منبع داده" value={chart.dataSource} mono />
                <Metric
                  label="وضعیت تحلیل"
                  value={chart.status === 'ok' ? 'کامل' : chart.status === 'insufficient_data' ? 'داده ناکافی' : 'در دسترس نیست'}
                  tone={chart.status === 'ok' ? 'text-bull' : 'text-warn'}
                />
                <Metric label="تعداد کندل" value={format.integer(candles.length)} />
                <Metric
                  label="قیمت آخرین کندل"
                  value={lastCandle ? format.number(lastCandle.close) : '—'}
                  tone={
                    (change ?? 0) > 0 ? 'text-bull' : (change ?? 0) < 0 ? 'text-bear' : 'text-ink'
                  }
                />
                <Metric
                  label={`تغییر بازه ${format.integer(candles.length)} کندل`}
                  value={change === null ? '—' : format.percent(change)}
                  tone={
                    (change ?? 0) > 0
                      ? 'text-bull'
                      : (change ?? 0) < 0
                        ? 'text-bear'
                        : 'text-ink-muted'
                  }
                />
                <Metric
                  label="زمان آخرین کندل"
                  value={lastCandle ? format.dateTime(new Date(lastCandle.time).toISOString()) : '—'}
                />
                <Metric label="زمان دریافت" value={format.dateTime(chart.generatedAt)} />
                <Metric
                  label="وضعیت آخرین کندل"
                  value={
                    chart.lastCandleStatus === 'forming'
                      ? 'در حال تشکیل'
                      : chart.lastCandleStatus === 'unknown'
                        ? 'نامشخص'
                        : '—'
                  }
                  tone={chart.lastCandleStatus === 'forming' ? 'text-warn' : 'text-ink-muted'}
                />
                <Metric label="موتور تحلیل" value={`${chart.engine.id} ${chart.engine.version}`} mono />
                <Metric label="نماد TradingView" value={chart.tvSymbol} mono />
                <Metric label="تایم‌فریم" value={TIMEFRAME_LABELS[chart.timeframe]} />
              </div>
            )}

            {bootstrap && !bootstrap.marketData.supports.includes(selection.assetClass) ? (
              <p className="mt-4 rounded-lg border border-warn/35 bg-warn/[0.07] px-3 py-2.5 text-2xs leading-6 text-ink-muted">
                منبع داده فعلی کلاس دارایی «{ASSET_CLASS_LABELS[selection.assetClass]}» را پشتیبانی
                نمی‌کند. برای دریافت داده این کلاس، مقدار{' '}
                <span className="ltr-data">MARKET_DATA_PROVIDER</span> را در فایل{' '}
                <span className="ltr-data">.env</span> تنظیم کنید.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card className="nx-card-body">
          <div className="space-y-3">
            <Toggle
              checked={showEmbed}
              onChange={setShowEmbed}
              label="نمودار زنده TradingView"
              description="نمودار رسمی و زنده TradingView با اندیکاتورهای خودش (EMA، SMA، RSI، MACD، حجم). TradingView هیچ API برای خواندن کندل‌ها یا مقادیر اندیکاتورهایش منتشر نمی‌کند و استفاده غیرنمایشی از داده‌اش را محدود کرده است؛ بنابراین تحلیل نکسورا از منبع صرافی/بازار تغذیه می‌شود و ممکن است اعدادش کمی با این نمودار تفاوت داشته باشد."
            />

            {showEmbed ? (
              <TradingViewChart
                symbol={chart?.tvSymbol ?? effectiveSymbol}
                timeframe={selection.timeframe}
                theme={settings.theme}
                height={480}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-2xs leading-6 text-ink-muted">
                  برای مشاهده این نماد در سایت TradingView (خارج از نکسورا) از لینک زیر استفاده کنید.
                </p>
                <a
                  className="nx-btn-secondary text-xs"
                  href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(chart?.tvSymbol ?? effectiveSymbol)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  باز کردن در TradingView
                  <ExternalIcon width={14} height={14} />
                </a>
              </div>
            )}
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
