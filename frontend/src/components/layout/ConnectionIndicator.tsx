import { useSystem } from '../../context/SystemContext';
import { cn } from '../../lib/cn';

/**
 * Market-data connection status.
 *
 * Reports what is actually known: whether the API answered and which provider
 * supplies the candles. It only shows a green "connected" light when a real
 * market-data provider answered.
 */
export function ConnectionIndicator({ className }: { className?: string }): JSX.Element {
  const { health, error, loading, refreshHealth } = useSystem();

  const state: 'checking' | 'live' | 'offline' = (() => {
    if (error && !health) return 'offline';
    if (loading && !health) return 'checking';
    if (!health) return 'offline';
    return health.checks.marketData.mode === 'live' ? 'live' : 'offline';
  })();

  const presentation = {
    checking: { label: 'در حال بررسی…', dot: 'bg-ink-subtle', text: 'text-ink-muted' },
    live: { label: 'داده زنده', dot: 'bg-bull', text: 'text-bull' },
    offline: { label: 'منبع داده آماده نیست', dot: 'bg-bear', text: 'text-bear' },
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
