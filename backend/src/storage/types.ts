/**
 * Storage abstraction.
 *
 * The application only depends on the `Collection` / `Storage` interfaces, so a
 * PostgreSQL-backed driver can be substituted without touching services or
 * controllers. See `docs/ARCHITECTURE.md` for the migration path.
 */

export interface StorageDescription {
  /** Machine-readable driver id, surfaced in API metadata: `json` | `memory` | `postgres`. */
  driver: string;
  /** False when data is lost on restart (in-memory). */
  persistent: boolean;
  /** Optional human-readable note, e.g. the resolved data directory. */
  detail?: string;
}

/** Every stored document must be addressable by a string id. */
export interface StoredDocument {
  id: string;
}

export interface Collection<T extends StoredDocument> {
  /** Newest-first list, capped by `maxItems` configured on the collection. */
  list(options?: { limit?: number }): Promise<T[]>;
  get(id: string): Promise<T | null>;
  /** Insert or replace by `id`. */
  put(document: T): Promise<T>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export interface Storage {
  readonly description: StorageDescription;
  /**
   * Resolve (and lazily create) a named collection.
   * `maxItems` bounds how many documents are retained, oldest evicted first.
   */
  collection<T extends StoredDocument>(name: string, options?: { maxItems?: number }): Collection<T>;
  /** Called once during bootstrap. Must be safe to call more than once. */
  init(): Promise<void>;
  /** Cheap connectivity/health probe for `/api/health`. */
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}
