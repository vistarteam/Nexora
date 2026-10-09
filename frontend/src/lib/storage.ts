/**
 * Browser storage abstraction.
 *
 * The application never touches `window.localStorage` directly. Everything goes
 * through `KeyValueStorage`, so swapping in IndexedDB, a cookie adapter, or a
 * server-backed store later is a one-line change in `createStorage()`.
 */

export interface KeyValueStorage {
  /** A label for diagnostics and the Settings screen. */
  readonly driver: string;
  /** False when data will not survive a reload. */
  readonly persistent: boolean;
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /** Empties only the keys this application owns. */
  clearOwned(): void;
}

/** Every key the frontend writes is namespaced and versioned. */
export const STORAGE_KEYS = {
  settings: 'nexora.settings.v1',
  watchlist: 'nexora.watchlist.v1',
  historyCache: 'nexora.history-cache.v1',
  lastSelection: 'nexora.selection.v1',
} as const;

export const OWNED_KEYS: readonly string[] = Object.values(STORAGE_KEYS);

function createLocalStorageAdapter(): KeyValueStorage {
  const available = (() => {
    try {
      const probe = '__nexora_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      // Private mode, disabled storage, or a blocked third-party context.
      return false;
    }
  })();

  if (!available) return createMemoryStorageAdapter('memory (localStorage unavailable)');

  return {
    driver: 'localStorage',
    persistent: true,
    get<T>(key: string, fallback: T): T {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
      } catch {
        // Corrupt payloads must not break the app; fall back and clean up.
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        return fallback;
      }
    },
    set<T>(key: string, value: T): void {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Quota exceeded: the caller keeps its in-memory copy. */
      }
    },
    remove(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    clearOwned(): void {
      for (const key of OWNED_KEYS) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

export function createMemoryStorageAdapter(driverLabel = 'memory'): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    driver: driverLabel,
    persistent: false,
    get<T>(key: string, fallback: T): T {
      const raw = store.get(key);
      if (raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set<T>(key: string, value: T): void {
      store.set(key, JSON.stringify(value));
    },
    remove(key: string): void {
      store.delete(key);
    },
    clearOwned(): void {
      for (const key of OWNED_KEYS) store.delete(key);
    },
  };
}

let active: KeyValueStorage | null = null;

/** The storage adapter for this session. Safe to call from anywhere. */
export function createStorage(): KeyValueStorage {
  if (active) return active;
  active =
    typeof window === 'undefined'
      ? createMemoryStorageAdapter('memory (no window)')
      : createLocalStorageAdapter();
  return active;
}

/** Test seam: replace the adapter (used by unit tests). */
export function setStorage(storage: KeyValueStorage | null): void {
  active = storage;
}
