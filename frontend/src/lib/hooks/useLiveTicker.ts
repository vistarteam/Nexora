import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api';
import type { TickerSnapshot } from '../../types/nexora';

/**
 * Polls `/api/ticker` so a chart can move every second.
 *
 * Two deliberate choices:
 *
 *  - **Sequential, not interval-based.** The next request is scheduled only after
 *    the previous one settles, so a slow upstream degrades into a slower tick
 *    instead of piling up overlapping requests.
 *  - **A local one-second clock.** The countdown is recomputed from the last
 *    snapshot's close time against the browser clock, so it advances smoothly
 *    even when a poll is late — it never freezes waiting for the network.
 *
 * The previous snapshot is kept while a poll is in flight or failing, so the
 * chart never blanks out; `stale` reports that the displayed value is no longer
 * fresh.
 */

export interface LiveTickerState {
  snapshot: TickerSnapshot | null;
  /** Seconds until the forming candle closes, recomputed every second. */
  secondsToClose: number | null;
  error: ApiError | null;
  /** The last poll failed but a previous value is still displayed. */
  stale: boolean;
}

export interface LiveTickerInput {
  symbol: string | null;
  assetClass: string;
  timeframe: string;
}

export interface LiveTickerOptions {
  enabled?: boolean;
  /** Delay between polls once the previous one has settled. */
  intervalMs?: number;
}

const IDLE: LiveTickerState = { snapshot: null, secondsToClose: null, error: null, stale: false };

export function useLiveTicker(
  input: LiveTickerInput,
  options: LiveTickerOptions = {},
): LiveTickerState {
  const { enabled = true, intervalMs = 1_000 } = options;
  const { symbol, assetClass, timeframe } = input;

  const [snapshot, setSnapshot] = useState<TickerSnapshot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A different instrument invalidates the previous quote immediately.
  useEffect(() => {
    setSnapshot(null);
    setError(null);
  }, [symbol, assetClass, timeframe]);

  useEffect(() => {
    if (!enabled || !symbol) return undefined;

    const controller = new AbortController();
    let cancelled = false;
    let timer: number | undefined;

    const poll = async (): Promise<void> => {
      try {
        const result = await api.ticker({ symbol, assetClass, timeframe }, controller.signal);
        if (cancelled) return;
        setSnapshot(result.data);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError('دریافت قیمت زنده ناموفق بود.', { code: 'UNKNOWN' }),
        );
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), intervalMs);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, symbol, assetClass, timeframe, intervalMs]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  const secondsToClose = useMemo(() => {
    const closeTime = snapshot?.candleCloseTime;
    if (closeTime === null || closeTime === undefined) return null;
    return Math.round((closeTime - now) / 1_000);
  }, [snapshot?.candleCloseTime, now]);

  return useMemo(
    () =>
      snapshot === null && error === null
        ? IDLE
        : { snapshot, secondsToClose, error, stale: error !== null && snapshot !== null },
    [snapshot, secondsToClose, error],
  );
}
