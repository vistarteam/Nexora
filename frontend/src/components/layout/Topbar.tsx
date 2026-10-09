import { useLocation } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext';
import { Button } from '../ui/Button';
import { MenuIcon, MoonIcon, RefreshIcon, SunIcon } from '../ui/Icons';
import { ConnectionIndicator } from './ConnectionIndicator';
import { NAV_ITEMS } from './navigation';

/**
 * Sticky application bar.
 *
 * Shows the current section, the market-data connection state and the theme
 * toggle. On mobile it also owns the navigation trigger.
 */
export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }): JSX.Element {
  const location = useLocation();
  const { settings, update } = useSettings();

  const current =
    NAV_ITEMS.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))) ??
    NAV_ITEMS[0];

  const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-base-950/85 backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          aria-label="باز کردن منو"
          aria-expanded={false}
          onClick={onOpenMenu}
        >
          <MenuIcon />
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{current?.label ?? 'نکسورا'}</p>
          <p className="hidden truncate text-2xs text-ink-subtle sm:block">
            {current?.description ?? ''}
          </p>
        </div>

        <ConnectionIndicator className="hidden sm:inline-flex" />

        <Button
          variant="secondary"
          size="sm"
          aria-label={`تغییر به پوسته ${nextTheme === 'dark' ? 'تیره' : 'روشن'}`}
          title={`تغییر به پوسته ${nextTheme === 'dark' ? 'تیره' : 'روشن'}`}
          onClick={() => update('theme', nextTheme)}
        >
          {settings.theme === 'dark' ? <MoonIcon width={15} height={15} /> : <SunIcon width={15} height={15} />}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2 sm:hidden">
        <ConnectionIndicator />
        <Button
          variant="ghost"
          size="sm"
          aria-label="به‌روزرسانی وضعیت"
          onClick={() => window.location.reload()}
        >
          <RefreshIcon width={15} height={15} />
          <span className="text-2xs">به‌روزرسانی</span>
        </Button>
      </div>
    </header>
  );
}
