import { beforeEach, describe, expect, it } from 'vitest';
import {
  OWNED_KEYS,
  STORAGE_KEYS,
  createMemoryStorageAdapter,
  createStorage,
  setStorage,
} from './storage';

describe('memory storage adapter', () => {
  it('is explicitly non-persistent', () => {
    const storage = createMemoryStorageAdapter();
    expect(storage.persistent).toBe(false);
    expect(storage.driver).toBe('memory');
  });

  it('round-trips values of any shape', () => {
    const storage = createMemoryStorageAdapter();
    storage.set('obj', { a: 1, b: ['x'] });
    expect(storage.get('obj', null)).toEqual({ a: 1, b: ['x'] });
  });

  it('returns the fallback for a missing key', () => {
    const storage = createMemoryStorageAdapter();
    expect(storage.get('missing', 'fallback')).toBe('fallback');
  });

  it('removes a single key', () => {
    const storage = createMemoryStorageAdapter();
    storage.set('k', 1);
    storage.remove('k');
    expect(storage.get('k', null)).toBeNull();
  });

  it('clears every key the application owns, and only those', () => {
    const storage = createMemoryStorageAdapter();
    storage.set(STORAGE_KEYS.settings, { theme: 'light' });
    storage.set(STORAGE_KEYS.watchlist, ['BTC']);
    storage.set('someone-elses-key', 'keep me');

    storage.clearOwned();

    expect(storage.get(STORAGE_KEYS.settings, null)).toBeNull();
    expect(storage.get(STORAGE_KEYS.watchlist, null)).toBeNull();
    expect(storage.get('someone-elses-key', null)).toBe('keep me');
  });

  it('exposes exactly the namespaced owned keys', () => {
    expect(OWNED_KEYS.length).toBeGreaterThan(0);
    for (const key of OWNED_KEYS) {
      expect(key.startsWith('nexora.')).toBe(true);
    }
  });
});

describe('createStorage', () => {
  beforeEach(() => setStorage(null));

  it('falls back to memory when there is no window', () => {
    const storage = createStorage();
    expect(storage.persistent).toBe(false);
    expect(storage.driver).toContain('memory');
  });

  it('is a singleton so all callers share one adapter', () => {
    expect(createStorage()).toBe(createStorage());
  });
});
