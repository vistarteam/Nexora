import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api';
import type { BootstrapPayload, HealthPayload } from '../types/nexora';

/**
 * Global system status.
 *
 * Fetched once at start-up and exposed to every page, because several screens
 * need the same three facts: whether the data is demo, which provider is
 * configured, and whether the storage is durable. Polling keeps the topbar's
 * connection indicator truthful without each page polling separately.
 */
interface SystemContextValue {
  bootstrap: BootstrapPayload | null;
  health: HealthPayload | null;
  loading: boolean;
  error: ApiError | null;
  /** Polls `/api/health` on demand (also used by the topbar refresh button). */
  refreshHealth: () => Promise<void>;
  /** Reloads `/api/config`, e.g. after changing backend environment. */
  reloadBootstrap: () => Promise<void>;
  /** Convenience flags derived from the payloads. */
  isDemo: boolean;
  storagePersistent: boolean;
}

const SystemContext = createContext<SystemContextValue | null>(null);

const HEALTH_POLL_MS = 60_000;

export function SystemProvider({ children }: { children: ReactNode }): JSX.Element {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const reloadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, healthResult] = await Promise.all([
        api.bootstrap(),
        api.health().catch(() => null),
      ]);
      setBootstrap(configResult.data);
      setHealth(healthResult?.data ?? null);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError('خطای نامشخص در دریافت تنظیمات سیستم.', { code: 'UNKNOWN' }),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const result = await api.health();
      setHealth(result.data);
      // A successful poll also clears a previous connectivity error.
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError('خطای نامشخص در بررسی سلامت سرویس.', { code: 'UNKNOWN' }),
      );
    }
  }, []);

  useEffect(() => {
    void reloadBootstrap();
  }, [reloadBootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, HEALTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  const value = useMemo<SystemContextValue>(
    () => ({
      bootstrap,
      health,
      loading,
      error,
      refreshHealth,
      reloadBootstrap,
      isDemo: bootstrap?.marketData.isDemo ?? true,
      storagePersistent: bootstrap?.storage.persistent ?? false,
    }),
    [bootstrap, error, health, loading, refreshHealth, reloadBootstrap],
  );

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystem(): SystemContextValue {
  const context = useContext(SystemContext);
  if (!context) throw new Error('useSystem must be used inside <SystemProvider>');
  return context;
}
