import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { DemoBanner } from './DemoBanner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CloseIcon } from '../ui/Icons';
import { cn } from '../../lib/cn';

/**
 * Application shell.
 *
 * Desktop: a fixed sidebar on the inline-start edge (right, in RTL) and a
 * scrolling content column. Mobile: the same navigation in an overlay drawer
 * that closes on navigation, on Escape, and on an overlay click.
 */
export function AppShell(): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll and handle Escape while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    document.body.classList.add('no-scroll');
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.classList.remove('no-scroll');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-sidebar shrink-0 border-e border-border bg-base-900/60 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          drawerOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-base-950/70 transition-opacity',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ناوبری"
          className={cn(
            'absolute inset-y-0 start-0 w-[17.5rem] max-w-[85vw] border-e border-border bg-base-900 shadow-pop transition-transform duration-200',
            drawerOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          )}
        >
          <div className="flex items-center justify-end p-2">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-lg p-2 text-ink-muted transition hover:bg-base-800 hover:text-ink"
              aria-label="بستن منو"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      </div>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setDrawerOpen(true)} />
        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[100rem] space-y-4 sm:space-y-5">
            <DemoBanner />
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-border px-4 py-4 sm:px-5">
          <p className="text-2xs leading-6 text-ink-subtle">
            نکسورا · تحلیل تکنیکال خودکار است و توصیه سرمایه‌گذاری، پیش‌بینی قطعی یا تضمین سود نیست.
            نمودارها توسط TradingView ارائه می‌شوند.
          </p>
        </footer>
      </div>
    </div>
  );
}
