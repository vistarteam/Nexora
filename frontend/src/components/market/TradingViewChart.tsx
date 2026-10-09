import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { ExternalIcon } from '../ui/Icons';
import type { Timeframe } from '../../types/nexora';

/**
 * TradingView Advanced Chart embed.
 *
 * This is the *official* embed widget (`embed-widget-advanced-chart.js`). It is
 * a visual integration only: it is never used as a data source for the analysis
 * engine. Candles come from the backend market-data service instead, because the
 * widget exposes no supported API for programme-driven reads.
 *
 * The widget is a script that injects an iframe. React cannot manage that
 * DOM directly, so the container is owned imperatively: on any prop change the
 * container is emptied and the widget is rebuilt.
 */

/** NEXORA timeframes mapped onto TradingView interval codes. */
const TV_INTERVALS: Record<Timeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

const SCRIPT_ID = 'nexora-tradingview-widget';
const SCRIPT_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export interface TradingViewChartProps {
  /** TradingView ticker, e.g. `BINANCE:BTCUSDT`. */
  symbol: string;
  timeframe: Timeframe;
  theme: 'dark' | 'light';
  /** Height in CSS pixels. */
  height?: number;
  /** Called when the widget cannot be loaded (offline, blocked, script error). */
  onUnavailable?: (reason: string) => void;
  className?: string;
}

/** Load the embed script once per document, resolving when it is ready. */
let scriptPromise: Promise<void> | null = null;

function loadWidgetScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later retry to attempt the load again.
      scriptPromise = null;
      reject(new Error('اسکریپت ویجت TradingView بارگذاری نشد (شبکه یا مسدودسازی).'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function TradingViewChart({
  symbol,
  timeframe,
  theme,
  height = 520,
  onUnavailable,
  className,
}: TradingViewChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let cancelled = false;
    setError(null);
    setReady(false);

    const timer = window.setTimeout(() => {
      if (!cancelled && !container.querySelector('iframe')) {
        const reason = 'ویجت TradingView در بازه زمانی مورد انتظار بارگذاری نشد.';
        setError(reason);
        setReady(true);
        onUnavailable?.(reason);
      }
    }, 15_000);

    loadWidgetScript()
      .then(() => {
        if (cancelled) return;

        // Rebuild the widget from scratch: the embed reads its config from the
        // script tag's text content, so it cannot be updated in place.
        container.innerHTML = '';
        const widget = document.createElement('div');
        widget.className = 'tradingview-widget-container';
        widget.style.height = '100%';
        widget.style.width = '100%';

        const widgetInner = document.createElement('div');
        widgetInner.className = 'tradingview-widget-container__widget';
        widgetInner.style.height = '100%';
        widgetInner.style.width = '100%';
        widget.appendChild(widgetInner);

        const config = document.createElement('script');
        config.type = 'text/javascript';
        config.src = SCRIPT_SRC;
        config.async = true;
        config.innerHTML = JSON.stringify({
          autosize: true,
          symbol,
          interval: TV_INTERVALS[timeframe],
          timezone: 'Asia/Tehran',
          theme,
          style: '1',
          locale: 'fa_IR',
          backgroundColor: theme === 'dark' ? 'rgba(10, 15, 24, 1)' : 'rgba(255, 255, 255, 1)',
          gridColor: theme === 'dark' ? 'rgba(29, 39, 55, 0.6)' : 'rgba(226, 232, 240, 0.8)',
          hide_side_toolbar: false,
          allow_symbol_change: true,
          save_image: false,
          details: false,
          withdateranges: true,
          support_host: 'https://www.tradingview.com',
        });
        widget.appendChild(config);
        container.appendChild(widget);

        // The embed replaces the script with an iframe; once it exists we are done.
        window.setTimeout(() => {
          if (!cancelled && container.querySelector('iframe')) {
            setReady(true);
            window.clearTimeout(timer);
          }
        }, 1_200);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const reason =
          caught instanceof Error ? caught.message : 'بارگذاری ویجت TradingView ناموفق بود.';
        setError(reason);
        setReady(true);
        onUnavailable?.(reason);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (container) container.innerHTML = '';
    };
    // `onUnavailable` is intentionally excluded: callers commonly pass an
    // inline function and re-running the effect would rebuild the iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, theme, attempt]);

  return (
    <div className={cn('relative w-full overflow-hidden rounded-lg border border-border bg-base-900', className)}>
      <div
        ref={containerRef}
        style={{ height }}
        className="tradingview-widget-container w-full"
        aria-label={`نمودار TradingView برای ${symbol}`}
      />

      {!ready && !error ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-base-900/60">
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-accent/70 border-t-transparent"
            />
            در حال بارگذاری نمودار TradingView…
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-base-900/95 px-4 text-center">
          <div className="max-w-md">
            <p className="text-sm font-medium text-ink">نمودار TradingView در دسترس نیست</p>
            <p className="mt-1.5 text-2xs leading-6 text-ink-muted">
              {error} این مشکل معمولاً به دلیل نبود دسترسی شبکه یا مسدود بودن دامنه
              <span className="ltr-data"> s3.tradingview.com </span>
              رخ می‌دهد. تحلیل‌ها و داده‌های این صفحه مستقل از این ویجت کار می‌کنند.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
                تلاش مجدد
              </Button>
              <a
                className="nx-btn nx-btn-ghost text-xs"
                href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                باز کردن در TradingView
                <ExternalIcon width={14} height={14} />
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
