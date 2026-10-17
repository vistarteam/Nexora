import type { AnalysisReport, ChartPayload } from '../types/nexora';
import {
  TIMEFRAME_LABELS,
  formatNumber,
  formatPercent,
  pricePrecision,
  type NumeralStyle,
} from './format';

/**
 * Exporting an analysis as text, as an image, or as a PDF.
 *
 * No dependency is added for this. A PDF here is the browser's own print engine
 * applied to the live page (so the chart is rasterised by the browser exactly as
 * rendered, not screenshotted through a third-party library), and the text export
 * is built from the report object rather than scraped from the DOM — so the file
 * a user keeps says the same thing as the screen it came from.
 */

const LABELS = {
  title: 'گزارش تحلیل تکنیکال',
  symbol: 'نماد',
  name: 'نام',
  assetClass: 'کلاس دارایی',
  timeframe: 'تایم‌فریم',
  createdAt: 'زمان تولید',
  dataTimestamp: 'زمان داده',
  price: 'قیمت آخرین کندل',
  candles: 'تعداد کندل',
  source: 'منبع داده',
  engine: 'موتور تحلیل',
  status: 'وضعیت',
  indicators: 'اندیکاتورها',
  trend: 'روند',
  direction: 'جهت',
  strength: 'قدرت',
  levels: 'سطوح حمایت و مقاومت',
  supports: 'حمایت‌ها',
  resistances: 'مقاومت‌ها',
  interpretation: 'تفسیر',
  summary: 'خلاصه',
  scenarios: 'سناریوهای شرطی',
  condition: 'شرط فعال‌شدن',
  invalidation: 'شرط باطل‌شدن',
  confidence: 'اطمینان',
  warnings: 'هشدارها',
  disclaimer: 'سلب مسئولیت',
  levelsTableHead: 'قیمت | فاصله | برخورد | نوع',
} as const;

const ASSET_CLASS_LABELS: Record<string, string> = {
  crypto: 'ارز دیجیتال',
  forex: 'فارکس',
  stocks: 'سهام',
};

const DIRECTION_LABELS: Record<string, string> = {
  uptrend: 'صعودی',
  downtrend: 'نزولی',
  sideways: 'بدون روند',
  unknown: 'نامشخص',
};

const STATUS_LABELS: Record<string, string> = {
  ok: 'کامل',
  insufficient_data: 'داده ناکافی',
  unavailable: 'در دسترس نیست',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  low: 'کم',
  medium: 'متوسط',
  high: 'زیاد',
};

const BIAS_LABELS: Record<string, string> = {
  bullish: 'صعودی',
  bearish: 'نزولی',
  neutral: 'بی‌طرف',
};

/** A filesystem-safe base name for an export of this report. */
export function reportFileName(report: AnalysisReport, extension: string): string {
  const symbol = report.symbol.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = report.createdAt.replace(/[:.]/g, '-');
  return `nexora-${symbol}-${report.timeframe}-${stamp}.${extension}`;
}

function number(value: number | null | undefined, style: NumeralStyle): string {
  return formatNumber(value, { style, precision: pricePrecision(value ?? 0) });
}

function levelsTable(
  levels: NonNullable<AnalysisReport['facts']>['levels'],
  style: NumeralStyle,
): string[] {
  if (!levels) return [];
  const rows: string[] = [`| ${LABELS.levelsTableHead} |`, '| --- | --- | --- | --- |'];
  const push = (entries: typeof levels.supports): void => {
    for (const level of entries) {
      rows.push(
        `| ${number(level.price, style)} | ${formatPercent(level.distancePercent, { style })} | ` +
          `${formatNumber(level.touches, { style, precision: 0 })} | ` +
          `${level.kind === 'pivot' ? 'پیوت' : 'سوئینگ'} |`,
      );
    }
  };
  push(levels.supports);
  push(levels.resistances);
  return rows;
}

/**
 * The report as Markdown.
 *
 * Facts, interpretation and scenarios keep the same separation they have on
 * screen, because that separation is the point: a reader of the exported file
 * must be able to tell a computed number from a reading of it.
 */
export function buildReportText(
  report: AnalysisReport,
  options: { chart?: ChartPayload | null; style?: NumeralStyle } = {},
): string {
  const style = options.style ?? 'fa';
  const lines: string[] = [];
  const facts = report.facts;

  lines.push(`# ${LABELS.title} — ${report.name}`, '');
  lines.push(`- ${LABELS.symbol}: \`${report.symbol}\` (${report.tvSymbol})`);
  lines.push(`- ${LABELS.name}: ${report.name}`);
  lines.push(`- ${LABELS.assetClass}: ${ASSET_CLASS_LABELS[report.assetClass] ?? report.assetClass}`);
  lines.push(`- ${LABELS.timeframe}: ${TIMEFRAME_LABELS[report.timeframe]}`);
  lines.push(`- ${LABELS.createdAt}: ${report.createdAt}`);
  if (report.dataTimestamp) lines.push(`- ${LABELS.dataTimestamp}: ${report.dataTimestamp}`);
  lines.push(`- ${LABELS.source}: ${report.dataSource} (${report.mode})`);
  lines.push(`- ${LABELS.engine}: ${report.engine.name} ${report.engine.version}`);
  lines.push(`- ${LABELS.status}: ${STATUS_LABELS[report.status] ?? report.status}`);

  if (facts) {
    lines.push(
      '',
      `## ${LABELS.indicators}`,
      '',
      `- ${LABELS.price}: ${number(facts.lastCandle?.close ?? null, style)}`,
      `- ${LABELS.candles}: ${formatNumber(facts.candleCount, { style, precision: 0 })}`,
      `- RSI: ${number(facts.indicators.rsi?.value ?? null, style)}` +
        (facts.indicators.rsi?.state ? ` (${facts.indicators.rsi.state})` : ''),
      `- MACD: ${number(facts.indicators.macd?.macd ?? null, style)} · ` +
        `signal ${number(facts.indicators.macd?.signal ?? null, style)} · ` +
        `hist ${number(facts.indicators.macd?.histogram ?? null, style)}`,
      `- ATR: ${number(facts.indicators.atr?.value ?? null, style)}`,
    );

    for (const ma of facts.indicators.sma) {
      lines.push(`- SMA${ma.period}: ${number(ma.value, style)}`);
    }
    for (const ma of facts.indicators.ema) {
      lines.push(`- EMA${ma.period}: ${number(ma.value, style)}`);
    }

    if (facts.trend) {
      lines.push(
        '',
        `## ${LABELS.trend}`,
        '',
        `- ${LABELS.direction}: ${DIRECTION_LABELS[facts.trend.direction] ?? facts.trend.direction}`,
        `- ${LABELS.strength}: ${formatNumber(facts.trend.strength, { style, precision: 1 })}`,
      );
      for (const item of facts.trend.evidence) lines.push(`- ${item}`);
    }

    if (facts.levels) {
      lines.push('', `## ${LABELS.levels}`, '');
      lines.push(`### ${LABELS.supports}`, '', ...levelsTable(facts.levels, style));
      lines.push('', `### ${LABELS.resistances}`, '', ...levelsTable(facts.levels, style));
    }
  }

  if (report.interpretation) {
    lines.push(
      '',
      `## ${LABELS.interpretation}`,
      '',
      report.interpretation.summary,
      '',
      `**${LABELS.summary} / ${LABELS.trend}:** ${report.interpretation.trendReading}`,
      '',
      `**${LABELS.summary} / مومنتوم:** ${report.interpretation.momentumReading}`,
      '',
      `**${LABELS.summary} / نوسان:** ${report.interpretation.volatilityReading}`,
    );
    if (report.interpretation.caveats.length > 0) {
      lines.push('', `### ${LABELS.warnings}`);
      for (const caveat of report.interpretation.caveats) lines.push(`- ${caveat}`);
    }
  }

  if (report.scenarios.length > 0) {
    lines.push('', `## ${LABELS.scenarios}`, '');
    for (const scenario of report.scenarios) {
      lines.push(
        `### ${scenario.title} (${BIAS_LABELS[scenario.bias] ?? scenario.bias})`,
        '',
        `- ${LABELS.confidence}: ${CONFIDENCE_LABELS[scenario.confidence] ?? scenario.confidence}`,
        `- ${LABELS.condition}: ${scenario.condition}`,
        `- ${LABELS.invalidation}: ${scenario.invalidation}`,
        '',
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push(`## ${LABELS.warnings}`, '');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  const chart = options.chart;
  if (chart) {
    lines.push(
      `## نمودار`,
      '',
      `نمودار این گزارش از همین ${formatNumber(chart.candles.length, { style, precision: 0 })} ` +
        'کندل و خروجی همین موتور رسم شده است و برای دیدن آن فایل PDF را ببینید.',
      '',
    );
  }

  lines.push(`---`, '', `**${LABELS.disclaimer}:** ${report.disclaimer}`, '');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Browser side-effects. Kept at the bottom so the builders above stay
 * pure and testable.
 * ------------------------------------------------------------------ */

/** Trigger a download of an in-memory text file. */
export function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(fileName, url);
  // Revoke on the next tick: revoking immediately can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function triggerDownload(fileName: string, url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Copy text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Composite the chart's canvases into one PNG and download it.
 *
 * The charting library draws into several 2D canvases (one per pane plus the two
 * scales); the browser cannot export them as a unit, so they are painted onto an
 * offscreen canvas at their on-screen offsets. Returns false when there is
 * nothing to capture or the canvas is tainted, so the caller can offer the print
 * route instead.
 */
export function exportChartImage(container: HTMLElement | null, fileName: string): boolean {
  if (!container) return false;
  const canvases = Array.from(container.querySelectorAll('canvas'));
  if (canvases.length === 0) return false;

  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const ratio = window.devicePixelRatio || 1;
  const output = document.createElement('canvas');
  output.width = Math.round(rect.width * ratio);
  output.height = Math.round(rect.height * ratio);

  const context = output.getContext('2d');
  if (!context) return false;

  // Paint the panel colour first: canvas sources are transparent where nothing
  // was drawn, and a transparent PNG of a dark chart is unreadable.
  context.fillStyle = window.getComputedStyle(container).backgroundColor || '#0a0f18';
  context.fillRect(0, 0, output.width, output.height);

  for (const canvas of canvases) {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    try {
      context.drawImage(
        canvas,
        (box.left - rect.left) * ratio,
        (box.top - rect.top) * ratio,
        box.width * ratio,
        box.height * ratio,
      );
    } catch {
      // A single unreadable pane must not abort the whole export.
    }
  }

  try {
    triggerDownload(fileName, output.toDataURL('image/png'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the browser's print dialog, which is also its PDF exporter.
 *
 * Printing the *live* page rather than a generated document is what makes the
 * chart appear: the browser rasterises the real canvas, so the PDF contains the
 * same picture as the screen. The print stylesheet narrows the page to the
 * element marked `nx-print-region`.
 */
export function printReport(): void {
  window.print();
}

/** Element class that marks the printable region of a page. */
export const PRINT_REGION_CLASS = 'nx-print-region';
