import { useCallback, useEffect, useRef, useState } from 'react';
import { createStorage } from '../storage';

/**
 * `useState` whose value is persisted through the storage abstraction.
 *
 * Reads once on mount, then writes on every change. A `storage` event listener
 * keeps two open tabs of the same app in sync, which matters for the watchlist
 * and theme.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((previous: T) => T)) => void, { reset: () => void }] {
  const storageRef = useRef(createStorage());

  const [state, setState] = useState<T>(() => {
    const stored = storageRef.current.get<T | undefined>(key, undefined);
    return stored === undefined ? initialValue : stored;
  });

  const setValue = useCallback(
    (value: T | ((previous: T) => T)) => {
      setState((previous) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(previous) : value;
        storageRef.current.set(key, next);
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    storageRef.current.remove(key);
    setState(initialValue);
  }, [initialValue, key]);

  // Cross-tab synchronisation.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (event: StorageEvent): void => {
      if (event.key !== key) return;
      const next = storageRef.current.get<T | undefined>(key, undefined);
      if (next !== undefined) setState(next);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  return [state, setValue, { reset }];
}
