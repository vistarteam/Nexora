import { useSystem } from '../../context/SystemContext';
import { AlertIcon } from '../ui/Icons';

/**
 * Persistent demo-mode notice.
 *
 * Rendered globally whenever the backend is configured with a demo provider, so
 * a user can never mistake synthetic candles for the real market. It is not
 * dismissible by design.
 */
export function DemoBanner(): JSX.Element | null {
  const { bootstrap, isDemo } = useSystem();
  if (!isDemo || !bootstrap) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warn/40 bg-warn/[0.08] px-3.5 py-2.5 sm:items-center"
    >
      <AlertIcon width={16} height={16} className="mt-0.5 shrink-0 text-warn sm:mt-0" />
      <p className="text-2xs leading-6 text-ink-muted">
        <span className="font-semibold text-warn">حالت دمو فعال است.</span>{' '}
        کندل‌ها و قیمت‌های نمایش‌داده‌شده ساختگی و تولیدی هستند و هیچ ارتباطی با بازار واقعی ندارند.
        برای دریافت داده واقعی، متغیر{' '}
        <span className="ltr-data rounded bg-base-900 px-1.5 py-0.5 text-[0.7rem] text-ink">
          MARKET_DATA_PROVIDER
        </span>{' '}
        را در فایل <span className="ltr-data">.env</span> تنظیم کنید.
      </p>
    </div>
  );
}
