import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ReportView } from '../components/analysis/ReportView';
import { SelectionBar } from '../components/market/SelectionBar';
import { Badge, DataModeBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { ChartIcon, RefreshIcon, SparkIcon } from '../components/ui/Icons';
import { PageHeader } from '../components/ui/PageHeader';
import { Toggle } from '../components/ui/Field';
import { useFormat, useSettings } from '../context/SettingsContext';
import { useSystem } from '../context/SystemContext';
import { useAnalysisRun } from '../lib/hooks/useAnalysisRun';
import { useDefaultSelection } from '../lib/hooks/useDefaultSelection';
import { useSelection } from '../lib/hooks/useSelection';
import { TIMEFRAME_LABELS } from '../lib/format';

/**
 * AI Technical Analysis.
 *
 * Runs the backend pipeline on demand and renders the resulting report. The
 * page itself computes nothing: every number on screen came from the analysis
 * engine over candles supplied by the market-data service.
 *
 * Reports are explicitly marked when they are demo-derived, and the report's
 * own `status` decides whether facts are shown at all.
 */
export function AiAnalysisPage(): JSX.Element {
  const defaults = useDefaultSelection();
  const { selection, setSymbol, setAssetClass, setTimeframe } = useSelection(defaults);
  const { settings, update } = useSettings();
  const { isDemo } = useSystem();
  const format = useFormat();
  const { state, run } = useAnalysisRun();
  const autoRanFor = useRef<string | null>(null);

  const effectiveSymbol = selection.symbol ?? defaults.symbol ?? 'BINANCE:BTCUSDT';
  const requestKey = `${effectiveSymbol}|${selection.assetClass}|${selection.timeframe}`;

  const execute = (save: boolean) => {
    void run({
      symbol: effectiveSymbol,
      assetClass: selection.assetClass,
      timeframe: selection.timeframe,
      save,
    });
  };

  // Optional auto-run: only when the user enabled it, and only once per
  // distinct symbol/timeframe combination.
  useEffect(() => {
    if (!settings.autoRunAnalysis) return;
    if (autoRanFor.current === requestKey) return;
    if (state.phase === 'running') return;
    autoRanFor.current = requestKey;
    execute(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, settings.autoRunAnalysis]);

  const report = state.report;
  const showStaleNotice =
    report !== null &&
    state.phase !== 'running' &&
    (report.symbol !== effectiveSymbol ||
      report.timeframe !== selection.timeframe ||
      report.assetClass !== selection.assetClass);

  return (
    <div>
      <PageHeader
        title="تحلیل هوشمند"
        description="اندیکاتورها، سطوح کلیدی، روند و سناریوهای شرطی — با تفکیک صریح میان داده محاسبه‌شده و تفسیر."
        badges={
          <>
            {isDemo ? <DataModeBadge mode="demo" /> : <Badge tone="bull" dot>داده واقعی</Badge>}
            <Badge tone="neutral">موتور پایتون + جایگزین تایپ‌اسکریپت</Badge>
          </>
        }
        actions={
          <Link
            to={`/market?symbol=${encodeURIComponent(effectiveSymbol)}&assetClass=${selection.assetClass}&timeframe=${selection.timeframe}`}
            className="nx-btn-secondary text-xs"
          >
            <ChartIcon width={14} height={14} />
            نمایش نمودار
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
        hint="تحلیل با ۳۰۰ کندل از تایم‌فریم انتخابی اجرا می‌شود؛ این تعداد برای دوره SMA200 و خط سیگنال MACD کافی است."
        actions={
          <Button
            variant="primary"
            onClick={() => execute(true)}
            loading={state.phase === 'running'}
            loadingLabel="در حال تحلیل…"
            icon={<SparkIcon width={15} height={15} />}
          >
            اجرای تحلیل
          </Button>
        }
      />

      <div className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
        <Card className="nx-card-body">
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              checked={settings.autoRunAnalysis}
              onChange={(checked) => update('autoRunAnalysis', checked)}
              label="اجرای خودکار تحلیل"
              description="با تغییر نماد یا تایم‌فریم، تحلیل به‌صورت خودکار اجرا شود."
            />
            <Toggle
              checked={settings.showCaveats}
              onChange={(checked) => update('showCaveats', checked)}
              label="نمایش محدودیت‌ها"
              description="بخش هشدارها و محدودیت‌های گزارش نمایش داده شود."
            />
          </div>
        </Card>

        {state.phase === 'running' && !report ? (
          <Card>
            <CardBody className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-accent/70 border-t-transparent"
                />
                در حال واکشی کندل‌ها و اجرای موتور تحلیل…
              </div>
              <Skeleton lines={6} />
            </CardBody>
          </Card>
        ) : null}

        {state.phase === 'error' && state.error ? (
          <ErrorState
            error={state.error}
            title="اجرای تحلیل ناموفق بود"
            onRetry={() => execute(true)}
          />
        ) : null}

        {state.phase === 'idle' && !report ? (
          <Card>
            <EmptyState
              icon={<SparkIcon width={22} height={22} />}
              title="تحلیلی اجرا نشده است"
              description="نماد و تایم‌فریم را انتخاب کنید و دکمه «اجرای تحلیل» را بزنید. نتیجه شامل اندیکاتورها، سطوح کلیدی، روند و سناریوهای شرطی خواهد بود."
              action={
                <Button variant="primary" onClick={() => execute(true)} icon={<SparkIcon width={15} height={15} />}>
                  اجرای تحلیل
                </Button>
              }
            />
          </Card>
        ) : null}

        {showStaleNotice ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/35 bg-info/[0.07] px-3.5 py-2.5">
            <p className="text-2xs leading-6 text-ink-muted">
              گزارش نمایش‌داده‌شده مربوط به نماد یا تایم‌فریم فعلی نیست. برای به‌روزرسانی، تحلیل را
              دوباره اجرا کنید.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => execute(true)}
              loading={state.phase === 'running'}
              icon={<RefreshIcon width={14} height={14} />}
            >
              اجرای مجدد
            </Button>
          </div>
        ) : null}

        {report && state.phase !== 'running' ? (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-base-900/50 px-3.5 py-2.5 text-2xs text-ink-muted">
              <span>
                وضعیت: <span className="text-ink">{phaseLabel(state.phase)}</span>
              </span>
              {state.durationMs !== null ? (
                <span>
                  زمان اجرا: <span className="num text-ink">{format.duration(state.durationMs)}</span>
                </span>
              ) : null}
              <span>
                ذخیره در تاریخچه:{' '}
                <span className={state.saved ? 'text-bull' : 'text-warn'}>
                  {state.saved ? 'انجام شد' : 'ذخیره نشد'}
                </span>
              </span>
              <span>
                نماد و تایم‌فریم:{' '}
                <span className="ltr-data text-ink">{report.symbol}</span>{' '}
                <span className="text-ink">{TIMEFRAME_LABELS[report.timeframe]}</span>
              </span>
              <Link to="/history" className="ms-auto nx-btn-ghost px-2 py-1 text-2xs">
                مشاهده تاریخچه
              </Link>
            </div>

            <ReportView report={report} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'running':
      return 'در حال اجرا';
    case 'done':
      return 'کامل شد';
    case 'error':
      return 'خطا';
    default:
      return 'آماده';
  }
}
