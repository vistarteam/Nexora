import fs from 'node:fs/promises';
import path from 'node:path';
import type { Collection, Storage, StorageDescription, StoredDocument } from './types.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('storage:json');

interface JsonCollectionOptions {
  directory: string;
  maxItems: number;
}

/**
 * JSON-file storage driver.
 *
 * One file per collection, atomic writes (temp file + rename) and a
 * serialising write queue so concurrent requests cannot interleave. This is
 * intentionally simple: it is a drop-in placeholder for PostgreSQL, not a
 * database.
 */
class JsonFileCollection<T extends StoredDocument> implements Collection<T> {
  private readonly filePath: string;
  private cache: T[] | null = null;
  /** Tail of the write chain; every mutation awaits the previous one. */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: JsonCollectionOptions, name: string) {
    this.filePath = path.join(options.directory, `${name}.json`);
  }

  private async read(): Promise<T[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = raw.trim() === '' ? [] : JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        log.warn('Could not read collection file, starting empty', {
          file: this.filePath,
          code,
        });
      }
      this.cache = [];
    }
    return this.cache;
  }

  private async write(documents: T[]): Promise<void> {
    await fs.mkdir(this.options.directory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.filePath);
    this.cache = documents;
  }

  /** Serialise a mutation behind the current write chain. */
  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writeChain.then(operation, operation);
    // Keep the chain alive even if an operation rejects.
    this.writeChain = result.catch(() => undefined);
    return result;
  }

  async list(listOptions: { limit?: number } = {}): Promise<T[]> {
    const documents = await this.read();
    const newestFirst = [...documents].reverse();
    return typeof listOptions.limit === 'number'
      ? newestFirst.slice(0, listOptions.limit)
      : newestFirst;
  }

  async get(id: string): Promise<T | null> {
    const documents = await this.read();
    return documents.find((document) => document.id === id) ?? null;
  }

  async put(document: T): Promise<T> {
    return this.enqueue(async () => {
      const documents = await this.read();
      const without = documents.filter((existing) => existing.id !== document.id);
      without.push(document);

      const overflow = without.length - this.options.maxItems;
      const trimmed = overflow > 0 ? without.slice(overflow) : without;
      await this.write(trimmed);
      return document;
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const documents = await this.read();
      const remaining = documents.filter((document) => document.id !== id);
      if (remaining.length === documents.length) return false;
      await this.write(remaining);
      return true;
    });
  }

  async count(): Promise<number> {
    return (await this.read()).length;
  }

  async clear(): Promise<void> {
    await this.enqueue(() => this.write([]));
  }
}

export class JsonFileStorage implements Storage {
  private readonly collections = new Map<string, JsonFileCollection<StoredDocument>>();
  private ready = false;

  constructor(private readonly directory: string) {}

  get description(): StorageDescription {
    return { driver: 'json', persistent: true, detail: this.directory };
  }

  async init(): Promise<void> {
    if (this.ready) return;
    // Fail loudly here so the factory can fall back to memory storage.
    await fs.mkdir(this.directory, { recursive: true });
    await fs.access(this.directory, fs.constants.W_OK);
    this.ready = true;
  }

  collection<T extends StoredDocument>(
    name: string,
    options: { maxItems?: number } = {},
  ): Collection<T> {
    if (!this.ready) {
      throw new Error('JsonFileStorage.init() must be awaited before resolving collections');
    }
    const existing = this.collections.get(name);
    if (existing) return existing as unknown as Collection<T>;

    const created = new JsonFileCollection<StoredDocument>(
      { directory: this.directory, maxItems: options.maxItems ?? 500 },
      name,
    );
    this.collections.set(name, created);
    return created as unknown as Collection<T>;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await fs.access(this.directory, fs.constants.W_OK);
      return { ok: true, detail: this.directory };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }

  async close(): Promise<void> {
    await this.writeChainBarrier();
  }

  private async writeChainBarrier(): Promise<void> {
    // Nothing to flush: every mutation awaits its own write. Kept explicit so
    // the contract is obvious when a buffered driver replaces this one.
  }
}
