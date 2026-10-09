import type { Collection, Storage, StorageDescription, StoredDocument } from './types.js';

interface MemoryCollectionOptions {
  maxItems: number;
}

class MemoryCollection<T extends StoredDocument> implements Collection<T> {
  /** Map preserves insertion order, which gives us a stable eviction order. */
  private readonly documents = new Map<string, T>();

  constructor(private readonly options: MemoryCollectionOptions) {}

  async list(listOptions: { limit?: number } = {}): Promise<T[]> {
    const all = [...this.documents.values()].reverse();
    return typeof listOptions.limit === 'number' ? all.slice(0, listOptions.limit) : all;
  }

  async get(id: string): Promise<T | null> {
    return this.documents.get(id) ?? null;
  }

  async put(document: T): Promise<T> {
    // Re-inserting an existing key keeps its original position; delete first so
    // a write always moves the document to the newest end.
    this.documents.delete(document.id);
    this.documents.set(document.id, document);

    while (this.documents.size > this.options.maxItems) {
      const oldest = this.documents.keys().next();
      if (oldest.done) break;
      this.documents.delete(oldest.value);
    }
    return document;
  }

  async delete(id: string): Promise<boolean> {
    return this.documents.delete(id);
  }

  async count(): Promise<number> {
    return this.documents.size;
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}

/** Ephemeral storage used for tests and as a fallback when disk writes fail. */
export class MemoryStorage implements Storage {
  private readonly collections = new Map<string, MemoryCollection<StoredDocument>>();

  constructor(private readonly detail?: string) {}

  get description(): StorageDescription {
    const description: StorageDescription = { driver: 'memory', persistent: false };
    if (this.detail) description.detail = this.detail;
    return description;
  }

  collection<T extends StoredDocument>(
    name: string,
    options: { maxItems?: number } = {},
  ): Collection<T> {
    const existing = this.collections.get(name);
    if (existing) return existing as unknown as Collection<T>;

    const created = new MemoryCollection<StoredDocument>({ maxItems: options.maxItems ?? 500 });
    this.collections.set(name, created);
    return created as unknown as Collection<T>;
  }

  async init(): Promise<void> {}

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'in-memory' };
  }

  async close(): Promise<void> {
    this.collections.clear();
  }
}
