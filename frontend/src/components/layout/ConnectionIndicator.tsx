import { useSystem } from '../../context/SystemContext';
import { cn } from '../../lib/cn';

/**
 * Market-data connection status.
 *
 * Reports what is actually known: whether the API answered, which provider is
 * configured, and whether that provider serves live or demo data. It never
 * shows a green "connected" light for demo data, because demo candles are not a
 * market connection.
 */
export function ConnectionIndicator({ className }: { className?: string }): JSX.Element {
  const { health, error, loading, refreshHealth, isDemo } = useSystem();

  const state: 'checking' | 'live' | 'demo' | 'offline' = (() => {
    if (error && !health) return 'offline';
    if (loading && !health) return 'checking';
    if (!health) return 'offline';
    if (isDemo) return 'demo';
    return 'live';
  })();

  const presentation = {
    checking: { label: 'در حال بررسی…', dot: 'bg-ink-subtle', text: 'text-ink-muted' },
    live: { label: 'داده زنده', dot: 'bg-bull', text: 'text-bull' },
    demo: { label: 'حالت دمو', dot: 'bg-warn', text: 'text-warn' },
    offline: { label: 'قطع ارتباط', dot: 'bg-bear', text: 'text-bear' },
  }[state];

  const providerLabel = health?.checks.marketData.provider ?? '—';

  return (
    <button
      type="button"
      onClick={() => void refreshHealth()}
      title="برای بررسی مجدد وضعیت اتصال کلیک کنید"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-border bg-base-900 px-2.5 py-1.5 text-2xs transition hover:border-border-strong',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          presentation.dot,
          state === 'checking' && 'animate-pulse-soft',
        )}
      />
      <span className={presentation.text}>{presentation.label}</span>
      <span className="hidden text-ink-subtle sm:inline">
        · <span className="ltr-data">{providerLabel}</span>
      </span>
    </button>
  );
}
