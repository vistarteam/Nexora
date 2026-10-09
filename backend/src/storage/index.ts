import { config } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { JsonFileStorage } from './jsonFileStorage.js';
import { MemoryStorage } from './memoryStorage.js';
import type { Storage } from './types.js';

export * from './types.js';
export { JsonFileStorage } from './jsonFileStorage.js';
export { MemoryStorage } from './memoryStorage.js';

const log = createLogger('storage');

/**
 * Build the configured storage driver.
 *
 * The JSON driver is attempted first and falls back to memory storage if the
 * directory is not writable. The fallback is never silent: the returned
 * storage reports `persistent: false`, which propagates into every API
 * response so the UI can warn the user that nothing will survive a restart.
 */
export async function createStorage(): Promise<Storage> {
  if (config.storage.driver === 'memory') {
    const storage = new MemoryStorage('STORAGE_DRIVER=memory');
    await storage.init();
    return storage;
  }

  const fileStorage = new JsonFileStorage(config.storage.dir);
  try {
    await fileStorage.init();
    log.info('Storage ready', { driver: 'json', directory: config.storage.dir });
    return fileStorage;
  } catch (error) {
    log.warn('JSON storage unavailable, falling back to in-memory storage', {
      directory: config.storage.dir,
      reason: (error as Error).message,
    });
    const fallback = new MemoryStorage(`disk unavailable: ${(error as Error).message}`);
    await fallback.init();
    return fallback;
  }
}

/** Collection names, kept in one place so a SQL migration is mechanical. */
export const COLLECTIONS = {
  watchlist: 'watchlist',
  reports: 'analysis-reports',
} as const;

export const COLLECTION_LIMITS = {
  watchlist: 200,
  reports: 500,
} as const;
