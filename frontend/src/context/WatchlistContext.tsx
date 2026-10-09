import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api } from '../lib/api';
import { usePersistentState } from '../lib/hooks/usePersistentState';
import { STORAGE_KEYS } from '../lib/storage';
import type { AssetClass, WatchlistItem } from '../types/nexora';

/**
 * The watchlist.
 *
 * Two layers on purpose:
 *  - the **server** copy is durable and shared across devices, and
 *  - a **local cache** lets the list render immediately on load and remain
 *    visible when the API is unreachable.
 *
 * Writes go to the server first; the local cache is updated only on success so
 * a failed write can never leave the UI claiming a symbol was saved.
 */
interface WatchlistContextValue {
  items: WatchlistItem[];
  loading: boolean;
  error: ApiError | null;
  /** True when the entries shown come from the local cache only. */
  stale: boolean;
  reload: () => Promise<void>;
  add: (symbol: string, assetClass: AssetClass) => Promise<boolean>;
  remove: (symbol: string) => Promise<boolean>;
  has: (symbol: string) => boolean;
  pendingSymbols: string[];
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }): JSX.Element {
  const [cache, setCache] = usePersistentState<WatchlistItem[]>(STORAGE_KEYS.watchlist, []);
  const [items, setItems] = useState<WatchlistItem[]>(cache);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [stale, setStale] = useState(false);
  const [pendingSymbols, setPendingSymbols] = useState<string[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.watchlist();
      setItems(result.data.items);
      setCache(result.data.items);
      setError(null);
      setStale(false);
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError('خطای نامشخص در دریافت واچ‌لیست.', { code: 'UNKNOWN' });
      setError(apiError);
      // Keep showing the cached list, but say so.
      setItems(cache);
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [cache, setCache]);

  useEffect(() => {
    void reload();
    // Intentionally runs once: `reload` changes whenever the cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(
    async (symbol: string, assetClass: AssetClass): Promise<boolean> => {
      const key = symbol.toUpperCase();
      setPendingSymbols((current) => [...current, key]);
      try {
        const result = await api.addToWatchlist({ symbol, assetClass });
        setItems((current) => {
          const without = current.filter((item) => item.symbol.toUpperCase() !== key);
          const next = [...without, result.data.item];
          setCache(next);
          return next;
        });
        setError(null);
        setStale(false);
        return true;
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError('افزودن نماد به واچ‌لیست ناموفق بود.', { code: 'UNKNOWN' }),
        );
        return false;
      } finally {
        setPendingSymbols((current) => current.filter((item) => item !== key));
      }
    },
    [setCache],
  );

  const remove = useCallback(
    async (symbol: string): Promise<boolean> => {
      const key = symbol.toUpperCase();
      setPendingSymbols((current) => [...current, key]);
      try {
        await api.removeFromWatchlist(symbol);
        setItems((current) => {
          const next = current.filter((item) => item.symbol.toUpperCase() !== key);
          setCache(next);
          return next;
        });
        setError(null);
        setStale(false);
        return true;
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError('حذف نماد از واچ‌لیست ناموفق بود.', { code: 'UNKNOWN' }),
        );
        return false;
      } finally {
        setPendingSymbols((current) => current.filter((item) => item !== key));
      }
    },
    [setCache],
  );

  const has = useCallback(
    (symbol: string) => items.some((item) => item.symbol.toUpperCase() === symbol.toUpperCase()),
    [items],
  );

  const value = useMemo<WatchlistContextValue>(
    () => ({ items, loading, error, stale, reload, add, remove, has, pendingSymbols }),
    [add, error, has, items, loading, pendingSymbols, reload, remove, stale],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error('useWatchlist must be used inside <WatchlistProvider>');
  return context;
}
