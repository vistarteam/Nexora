import { useCallback, useState } from 'react';
import { useFormat, useSettings } from '../../context/SettingsContext';
import {
  buildReportText,
  copyText,
  downloadTextFile,
  exportChartImage,
  printReport,
  reportFileName,
} from '../../lib/reportExport';
import type { AnalysisReport, ChartPayload } from '../../types/nexora';
import { Button } from '../ui/Button';

/**
 * Export controls for a finished analysis.
 *
 * Three routes, each for a different need: text for pasting into a note, PNG for
 * a chart that can be shared as an image, and PDF for the whole report. The PDF
 * route prints the live page (see the `nx-print-region` rules), so the chart in
 * the file is the chart on screen rather than a re-render that could differ.
 *
 * Marked `nx-no-print` so the controls themselves never appear in the output.
 */
export interface ExportBarProps {
  report: AnalysisReport;
  chart: ChartPayload | null;
  /** `id` of the element holding the chart, for the PNG export. */
  chartContainerId?: string;
}

type Notice = { tone: 'ok' | 'warn'; text: string } | null;

export function ExportBar({ report, chart, chartContainerId }: ExportBarProps): JSX.Element {
  const { settings } = useSettings();
  const format = useFormat();
  const [notice, setNotice] = useState<Notice>(null);

  const text = useCallback(
    () => buildReportText(report, { chart, style: settings.numerals }),
    [report, chart, settings.numerals],
  );

  const onCopy = useCallback(async () => {
    const ok = await copyText(text());
    setNotice(
      ok
        ? { tone: 'ok', text: 'متن گزارش در حافظه کپی شد.' }
        : { tone: 'warn', text: 'مرورگر اجازه کپی خودکار نداد؛ از «دانلود متن» استفاده کنید.' },
    );
  }, [text]);

  const onDownloadText = useCallback(() => {
    downloadTextFile(reportFileName(report, 'md'), text());
    setNotice({ tone: 'ok', text: 'فایل متنی گزارش دانلود شد.' });
  }, [report, text]);

  const onDownloadImage = useCallback(() => {
    const container = chartContainerId ? document.getElementById(chartContainerId) : null;
    const ok = container ? exportChartImage(container, reportFileName(report, 'png')) : false;
    setNotice(
      ok
        ? { tone: 'ok', text: 'تصویر نمودار دانلود شد.' }
        : { tone: 'warn', text: 'تصویر نمودار در این مرورگر قابل استخراج نبود؛ از خروجی PDF استفاده کنید.' },
    );
  }, [chartContainerId, report]);

  return (
    <div className="nx-no-print flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void onCopy()}>
        کپی متن
      </Button>
      <Button size="sm" variant="secondary" onClick={onDownloadText}>
        دانلود متن
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onDownloadImage}
        disabled={!chart}
        aria-label="دانلود تصویر نمودار"
      >
        تصویر نمودار
      </Button>
      <Button size="sm" variant="primary" onClick={printReport}>
        خروجی PDF
      </Button>

      {notice ? (
        <span
          role="status"
          className={notice.tone === 'ok' ? 'text-2xs text-bull' : 'text-2xs text-warn'}
        >
          {notice.text}
        </span>
      ) : null}

      <span className="text-2xs text-ink-subtle">
        PDF شامل نمودار و متن کامل است · منبع داده: {report.dataSource} · زمان اجرا:{' '}
        {format.dateTime(report.createdAt)}
      </span>
    </div>
  );
}
