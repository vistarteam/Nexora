import { COLLECTION_LIMITS, COLLECTIONS, type Collection, type Storage } from '../storage/index.js';
import type { AssetClass, WatchlistItem } from '../types/domain.js';
import { resolveSymbol } from './marketData/catalog.js';

/** Stored shape: the symbol is also the document id. */
interface WatchlistRecord extends WatchlistItem {
  id: string;
}

export interface AddWatchlistInput {
  symbol: string;
  assetClass: AssetClass;
}

/**
 * Watchlist storage.
 *
 * The frontend also keeps a local copy behind its own storage abstraction so
 * the list stays usable offline; the server copy is the durable one.
 */
export class WatchlistService {
  private readonly items: Collection<WatchlistRecord>;

  constructor(storage: Storage) {
    this.items = storage.collection<WatchlistRecord>(COLLECTIONS.watchlist, {
      maxItems: COLLECTION_LIMITS.watchlist,
    });
  }

  async list(): Promise<WatchlistItem[]> {
    const records = await this.items.list();
    // Oldest-first reads more naturally for a curated list.
    return [...records].reverse().map(toItem);
  }

  async add(input: AddWatchlistInput): Promise<{ item: WatchlistItem; created: boolean }> {
    const resolved = resolveSymbol(input.symbol, input.assetClass);
    const id = resolved.symbol.toUpperCase();
    const existing = await this.items.get(id);

    if (existing) return { item: toItem(existing), created: false };

    const record: WatchlistRecord = {
      id,
      symbol: resolved.symbol,
      tvSymbol: resolved.tvSymbol,
      name: resolved.name,
      assetClass: resolved.assetClass,
      addedAt: new Date().toISOString(),
    };
    await this.items.put(record);
    return { item: toItem(record), created: true };
  }

  async remove(symbol: string): Promise<boolean> {
    return this.items.delete(symbol.trim().toUpperCase());
  }

  async removeMany(symbols: string[]): Promise<number> {
    let removed = 0;
    for (const symbol of symbols) {
      if (await this.remove(symbol)) removed += 1;
    }
    return removed;
  }

  async count(): Promise<number> {
    return this.items.count();
  }
}

function toItem(record: WatchlistRecord): WatchlistItem {
  return {
    symbol: record.symbol,
    tvSymbol: record.tvSymbol,
    name: record.name,
    assetClass: record.assetClass,
    addedAt: record.addedAt,
  };
}
