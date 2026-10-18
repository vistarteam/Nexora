/**
 * Historical Candle Storage & Retrieval Service.
 *
 * Responsibilities:
 * - Store candles persistently with deduplication
 * - Query candles by symbol, timeframe, and time range
 * - Validate time alignment and detect gaps
 * - Track data quality and freshness
 * - Prevent data leakage: enforce temporal boundaries
 */

import { randomUUID } from 'node:crypto';
import type { Candle, Timeframe } from '../../types/domain.js';
import type { DataQuality } from '../../types/forecasting.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('data:historical');

export interface StoredCandle extends Candle {
  symbol: string;
  timeframe: Timeframe;
  source: string;
  fetchedAt: string;
  isClosed: boolean;
}

export interface Dataset {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  startTime: number;
  endTime: number;
  candleCount: number;
  source: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataQualityReport {
  quality: DataQuality;
  candleCount: number;
  missingCount: number;
  gapCount: number;
  duplicateCount: number;
  outOfOrderCount: number;
  freshness: 'current' | 'stale' | 'very_stale';
  issues: string[];
}

export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  startTime?: number;
  endTime?: number;
  limit?: number;
  onlyClosedCandles?: boolean;
}

class HistoricalDataStore {
  private candles: Map<string, StoredCandle[]> = new Map();
  private datasets: Map<string, Dataset> = new Map();

  private getKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}:${timeframe}`;
  }

  storeCandles(params: {
    symbol: string;
    timeframe: Timeframe;
    candles: Candle[];
    source: string;
    fetchedAt: string;
  }): { added: number; deduplicated: number } {
    const { symbol, timeframe, candles, source, fetchedAt } = params;
    const key = this.getKey(symbol, timeframe);

    const existing = this.candles.get(key) || [];
    const existingTimes = new Set(existing.map((c) => c.time));

    let added = 0;
    let deduplicated = 0;

    for (const candle of candles) {
      if (existingTimes.has(candle.time)) {
        deduplicated++;
        continue;
      }

      const stored: StoredCandle = {
        ...candle,
        symbol,
        timeframe,
        source,
        fetchedAt,
        isClosed: true,
      };

      existing.push(stored);
      existingTimes.add(candle.time);
      added++;
    }

    existing.sort((a, b) => a.time - b.time);
    this.candles.set(key, existing);
    this.updateDatasetMetadata(symbol, timeframe, existing, source);

    log.debug('Stored candles', { symbol, timeframe, added, deduplicated, total: existing.length });
    return { added, deduplicated };
  }

  queryCandles(query: CandleQuery): StoredCandle[] {
    const { symbol, timeframe, startTime, endTime, limit, onlyClosedCandles } = query;
    const key = this.getKey(symbol, timeframe);
    let candles = this.candles.get(key) || [];

    if (startTime !== undefined) {
      candles = candles.filter((c) => c.time >= startTime);
    }
    if (endTime !== undefined) {
      candles = candles.filter((c) => c.time <= endTime);
    }
    if (onlyClosedCandles) {
      candles = candles.filter((c) => c.isClosed);
    }
    if (limit !== undefined && limit > 0) {
      candles = candles.slice(-limit);
    }

    return candles;
  }

  getDataset(symbol: string, timeframe: Timeframe): Dataset | null {
    const key = this.getKey(symbol, timeframe);
    return this.datasets.get(key) || null;
  }

  getAllDatasets(): Dataset[] {
    return Array.from(this.datasets.values());
  }

  clear(): void {
    this.candles.clear();
    this.datasets.clear();
  }

  private updateDatasetMetadata(
    symbol: string,
    timeframe: Timeframe,
    candles: StoredCandle[],
    source: string,
  ): void {
    const key = this.getKey(symbol, timeframe);
    const existing = this.datasets.get(key);
    const now = new Date().toISOString();

    if (candles.length === 0) return;

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    if (!firstCandle || !lastCandle) return;

    const dataset: Dataset = {
      id: existing?.id || randomUUID(),
      symbol,
      timeframe,
      startTime: firstCandle.time,
      endTime: lastCandle.time,
      candleCount: candles.length,
      source,
      version: existing ? this.incrementVersion(existing.version) : '1.0.0',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.datasets.set(key, dataset);
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0', 10);
    return `${parts[0]}.${parts[1]}.${patch + 1}`;
  }
}

const store = new HistoricalDataStore();

export function storeCandles(params: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: string;
}): { added: number; deduplicated: number } {
  return store.storeCandles({ ...params, fetchedAt: new Date().toISOString() });
}

export function fetchHistoricalCandles(query: CandleQuery): StoredCandle[] {
  return store.queryCandles(query);
}

export function getDataset(symbol: string, timeframe: Timeframe): Dataset | null {
  return store.getDataset(symbol, timeframe);
}

export function listDatasets(): Dataset[] {
  return store.getAllDatasets();
}

export function assessDataQuality(query: CandleQuery): DataQualityReport {
  const candles = store.queryCandles(query);
  const issues: string[] = [];

  if (candles.length === 0) {
    return {
      quality: 'insufficient',
      candleCount: 0,
      missingCount: 0,
      gapCount: 0,
      duplicateCount: 0,
      outOfOrderCount: 0,
      freshness: 'very_stale',
      issues: ['No data available'],
    };
  }

  const timeframeMs = getTimeframeMs(query.timeframe);
  let gapCount = 0;
  for (let i = 1; i < candles.length; i++) {
    const prevCandle = candles[i - 1];
    const currCandle = candles[i];
    if (prevCandle && currCandle) {
      const expectedTime = prevCandle.time + timeframeMs;
      const actualTime = currCandle.time;
      if (actualTime > expectedTime + timeframeMs * 0.1) {
        gapCount++;
      }
    }
  }

  if (gapCount > 0) {
    issues.push(`${gapCount} gaps detected in time series`);
  }

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    return {
      quality: 'insufficient',
      candleCount: candles.length,
      missingCount: 0,
      gapCount,
      duplicateCount: 0,
      outOfOrderCount: 0,
      freshness: 'very_stale',
      issues: ['Last candle missing'],
    };
  }
  const lastCandleAge = Date.now() - lastCandle.time;
  const maxStaleness = timeframeMs * 5;
  let freshness: 'current' | 'stale' | 'very_stale';

  if (lastCandleAge < timeframeMs * 2) {
    freshness = 'current';
  } else if (lastCandleAge < maxStaleness) {
    freshness = 'stale';
    issues.push(`Data is ${Math.floor(lastCandleAge / timeframeMs)} candles old`);
  } else {
    freshness = 'very_stale';
    issues.push(`Data is very stale (${Math.floor(lastCandleAge / (24 * 3600 * 1000))} days old)`);
  }

  let quality: DataQuality;
  if (candles.length < 200) {
    quality = 'insufficient';
    issues.push(`Only ${candles.length} candles (need 200+)`);
  } else if (gapCount > candles.length * 0.05 || freshness === 'very_stale') {
    quality = 'degraded';
  } else {
    quality = 'good';
  }

  return {
    quality,
    candleCount: candles.length,
    missingCount: 0,
    gapCount,
    duplicateCount: 0,
    outOfOrderCount: 0,
    freshness,
    issues,
  };
}

function getTimeframeMs(timeframe: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
  };
  return map[timeframe] || 60 * 60 * 1000;
}

export function clearAllData(): void {
  store.clear();
  log.info('All historical data cleared');
}

