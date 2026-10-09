import { useFormat } from '../../context/SettingsContext';
import {
  ASSET_CLASS_LABELS,
  ENGINE_LABELS,
  TIMEFRAME_LABELS,
  TREND_LABELS,
} from '../../lib/format';
import type { AnalysisReport } from '../../types/nexora';
import { AnalysisStatusBadge, DataModeBadge } from '../ui/Badge';

function MetaItem({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-ink-subtle">{label}</dt>
      <dd className="num mt-1 truncate text-xs text-ink">{children}</dd>
    </div>
  );
}

/**
 * Everything a reader needs to judge a report before reading it: which
 * instrument, which timeframe, when the data was taken, how it was produced and
 * whether it succeeded.
 */
export function ReportMeta({ report }: { report: AnalysisReport }): JSX.Element {
  const format = useFormat();
  const price = report.facts?.lastCandle?.close ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AnalysisStatusBadge status={report.status} />
        <DataModeBadge mode={report.mode} />
        <span className="nx-chip border-border-strong bg-base-800 text-ink-muted">
          {ENGINE_LABELS[report.engine.id] ?? report.engine.id}
          <span className="ltr-data text-ink-subtle">{report.engine.version}</span>
        </span>
        {report.facts?.trend ? (
          <span className="nx-chip border-border-strong bg-base-800 text-ink-muted">
            روند: {TREND_LABELS[report.facts.trend.direction] ?? report.facts.trend.direction}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-base-900/50 p-3.5 sm:grid-cols-3 lg:grid-cols-4">
        <MetaItem label="نماد">
          <span className="ltr-data">{report.symbol}</span>
        </MetaItem>
        <MetaItem label="نام">{report.name}</MetaItem>
        <MetaItem label="کلاس دارایی">{ASSET_CLASS_LABELS[report.assetClass]}</MetaItem>
        <MetaItem label="تایم‌فریم">{TIMEFRAME_LABELS[report.timeframe]}</MetaItem>
        <MetaItem label="قیمت آخرین کندل">
          {price === null ? '—' : format.number(price)}
        </MetaItem>
        <MetaItem label="تعداد کندل">{report.facts ? format.integer(report.facts.candleCount) : '—'}</MetaItem>
        <MetaItem label="زمان داده">{format.dateTime(report.dataTimestamp)}</MetaItem>
        <MetaItem label="زمان تولید گزارش">{format.dateTime(report.createdAt)}</MetaItem>
        <MetaItem label="منبع داده">
          <span className="ltr-data">{report.dataSource}</span>
        </MetaItem>
      </dl>
    </div>
  );
}
