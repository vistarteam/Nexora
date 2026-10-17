import { NavLink } from 'react-router-dom';
import { useSystem } from '../../context/SystemContext';
import { cn } from '../../lib/cn';
import { NAV_ITEMS } from './navigation';

/**
 * Primary navigation.
 *
 * Sits on the inline-start edge, which is the right-hand side of this RTL
 * layout. The active item is conveyed with both colour and a marker so the
 * state is not colour-only.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { bootstrap } = useSystem();

  return (
    <nav aria-label="ناوبری اصلی" className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2.5 px-2 py-2">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent/10 text-sm font-bold text-accent"
        >
          N
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">نکسورا</p>
          <p className="truncate text-2xs text-ink-subtle">تحلیل تکنیکال هوشمند</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition',
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-ink-muted hover:bg-base-800 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-y-1.5 start-0 w-0.5 rounded-full transition',
                        isActive ? 'bg-accent' : 'bg-transparent',
                      )}
                    />
                    <Icon width={17} height={17} className="shrink-0" />
                    <span className="truncate font-medium">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 rounded-lg border border-border bg-base-900/70 px-3 py-2.5">
        <p className="text-2xs text-ink-subtle">وضعیت سرویس</p>
        <p className="mt-1 text-2xs text-ink-muted">
          {bootstrap ? `منبع داده: ${bootstrap.marketData.label}` : 'در حال دریافت وضعیت…'}
        </p>
      </div>
    </nav>
  );
}
