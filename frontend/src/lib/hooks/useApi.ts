import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

export interface UseApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True while a reload is in flight and previous data is still shown. */
  refreshing: boolean;
  /** Re-runs the fetcher. */
  reload: () => void;
}

/**
 * Fetch data for a view, with first-class loading / error / refetch states.
 *
 * Deliberately small: no cache, no dedupe, no stale-while-revalidate. The app
 * has few endpoints and no cross-view cache requirements, so a small hook is
 * easier to reason about than a query library. Aborts in-flight requests on
 * unmount or dependency change so a slow response cannot overwrite newer data.
 *
 * Pass `null` as the fetcher to skip the request entirely (e.g. an unnamed
 * selection) — the hook then reports neither loading nor error.
 */
export function useApi<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(fetcher !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Keep the latest fetcher in a ref so `deps` alone decide when to refetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasLoadedOnce = useRef(false);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const current = fetcherRef.current;
    if (!current) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    if (hasLoadedOnce.current) setRefreshing(true);
    else setLoading(true);
    setError(null);

    current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(
                caught instanceof Error ? caught.message : 'خطای نامشخص در دریافت داده.',
                { code: 'UNKNOWN' },
              ),
        );
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        hasLoadedOnce.current = true;
        setLoading(false);
        setRefreshing(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, ...deps]);

  return { data, error, loading, refreshing, reload };
}
