/**
 * TypeScript reference implementation of support/resistance detection.
 * Mirrors `analysis-engine/nexora_analysis/levels.py`.
 */

import type { SupportResistanceLevel } from '../../../types/domain.js';
import { atr, lastValue } from './indicators.js';

export interface SwingPoint {
  index: number;
  price: number;
}

export interface DetectedLevels {
  supports: SupportResistanceLevel[];
  resistances: SupportResistanceLevel[];
  nearestSupport: SupportResistanceLevel | null;
  nearestResistance: SupportResistanceLevel | null;
}

export function findSwings(
  highs: number[],
  lows: number[],
  lookback = 5,
): { swingHighs: SwingPoint[]; swingLows: SwingPoint[] } {
  if (lookback < 1) throw new Error('lookback must be at least 1');

  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];

  for (let index = lookback; index < highs.length - lookback; index += 1) {
    const highWindow = highs.slice(index - lookback, index + lookback + 1);
    const lowWindow = lows.slice(index - lookback, index + lookback + 1);
    const high = highs[index] as number;
    const low = lows[index] as number;

    if (high === Math.max(...highWindow) && highWindow.filter((value) => value === high).length === 1) {
      swingHighs.push({ index, price: high });
    }
    if (low === Math.min(...lowWindow) && lowWindow.filter((value) => value === low).length === 1) {
      swingLows.push({ index, price: low });
    }
  }

  return { swingHighs, swingLows };
}

interface Cluster {
  price: number;
  touches: number;
  kind: 'swing' | 'pivot';
  lastIndex: number;
}

export function clusterLevels(points: SwingPoint[], tolerance: number): Cluster[] {
  if (points.length === 0) return [];

  const ordered = [...points].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];
  let current: SwingPoint[] = [ordered[0] as SwingPoint];

  const summarise = (group: SwingPoint[]): Cluster => ({
    price: group.reduce((total, point) => total + point.price, 0) / group.length,
    touches: group.length,
    kind: 'swing',
    lastIndex: Math.max(...group.map((point) => point.index)),
  });

  for (const point of ordered.slice(1)) {
    const clusterPrice = current.reduce((total, item) => total + item.price, 0) / current.length;
    if (Math.abs(point.price - clusterPrice) <= tolerance) current.push(point);
    else {
      clusters.push(summarise(current));
      current = [point];
    }
  }
  clusters.push(summarise(current));
  return clusters;
}

export function classicPivots(
  highs: number[],
  lows: number[],
  closes: number[],
  window = 24,
): Array<{ label: string; price: number }> {
  if (closes.length < 2) return [];

  const start = Math.max(0, closes.length - window);
  const sessionHigh = Math.max(...highs.slice(start));
  const sessionLow = Math.min(...lows.slice(start));
  const sessionClose = closes[closes.length - 1] as number;

  const pivot = (sessionHigh + sessionLow + sessionClose) / 3;
  const span = sessionHigh - sessionLow;

  return [
    { label: 'P', price: pivot },
    { label: 'R1', price: 2 * pivot - sessionLow },
    { label: 'S1', price: 2 * pivot - sessionHigh },
    { label: 'R2', price: pivot + span },
    { label: 'S2', price: pivot - span },
    { label: 'R3', price: sessionHigh + 2 * (pivot - sessionLow) },
    { label: 'S3', price: sessionLow - 2 * (sessionHigh - pivot) },
  ];
}

export function detectLevels(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 5,
  maxLevels = 5,
): DetectedLevels | null {
  if (closes.length < lookback * 2 + 3) return null;

  const lastPrice = closes[closes.length - 1] as number;
  const currentAtr = lastValue(atr(highs, lows, closes, 14));

  let tolerance = currentAtr !== null && currentAtr > 0 ? currentAtr * 0.75 : Math.abs(lastPrice) * 0.004;
  if (tolerance <= 0) tolerance = Math.max(Math.abs(lastPrice) * 0.001, 1e-8);

  const { swingHighs, swingLows } = findSwings(highs, lows, lookback);
  const candidates: Cluster[] = [
    ...clusterLevels(swingHighs, tolerance),
    ...clusterLevels(swingLows, tolerance),
  ];

  for (const pivot of classicPivots(highs, lows, closes, Math.min(closes.length, 24))) {
    candidates.push({
      price: pivot.price,
      touches: 1,
      kind: 'pivot',
      lastIndex: closes.length - 1,
    });
  }

  const merged: Cluster[] = [];
  for (const level of candidates.sort((a, b) => a.price - b.price)) {
    const price = Number(level.price.toFixed(6));
    if (price <= 0) continue;
    const existing = merged.find((item) => Math.abs(item.price - price) <= tolerance);
    if (existing) {
      if (level.kind === 'swing' && existing.kind === 'swing') existing.touches += level.touches;
      continue;
    }
    merged.push({ price, touches: level.touches, kind: level.kind, lastIndex: level.lastIndex });
  }

  const toLevel = (level: Cluster): SupportResistanceLevel => ({
    price: level.price,
    touches: level.touches,
    kind: level.kind,
    distancePercent:
      lastPrice === 0 ? 0 : ((level.price - lastPrice) / Math.abs(lastPrice)) * 100,
  });

  const supports = merged.filter((level) => level.price < lastPrice).map(toLevel);
  const resistances = merged.filter((level) => level.price > lastPrice).map(toLevel);

  // Nearest to the reference price first: levels are surfaced by their real distance
  // from the current price, so the closest level on each side is the first row and
  // `nearestSupport`/`nearestResistance` is always the first entry of its table.
  supports.sort((a, b) => b.distancePercent - a.distancePercent);
  resistances.sort((a, b) => a.distancePercent - b.distancePercent);

  const trimmedSupports = supports.slice(0, maxLevels);
  const trimmedResistances = resistances.slice(0, maxLevels);

  return {
    supports: trimmedSupports,
    resistances: trimmedResistances,
    nearestSupport: trimmedSupports[0] ?? null,
    nearestResistance: trimmedResistances[0] ?? null,
  };
}
