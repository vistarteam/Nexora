/**
 * Price zones — TypeScript reference implementation.
 *
 * Mirrors `analysis-engine/nexora_analysis/zones.py` (version `sr-zone-1.0`).
 * Both engines use confirmed swing pivots, ATR-normalised clustering, adaptive
 * widths, explicit merging and close-confirmed break rules. If the Python
 * engine is unavailable the fallback therefore still produces zones with the
 * same meaning, and the report records that the fallback ran.
 */

import type {
  Candle,
  HigherTimeframeZones,
  PriceZone,
  ZoneConfluence,
  ZoneRole,
  ZoneSet,
  ZoneStatus,
} from '../../../types/domain.js';
import { atr } from './indicators.js';

export const ZONE_METHOD_VERSION = 'sr-zone-1.0';
const ATR_PERIOD = 14;
const CLUSTER_TOLERANCE_ATR = 0.35;
const MIN_WIDTH_ATR = 0.25;
const MAX_WIDTH_ATR = 0.9;
const BREAK_BUFFER_ATR = 0.15;
const BREAK_CONFIRM_CLOSES = 2;
const MIN_REACTIONS = 2;
const MAX_BROKEN_ZONES = 2;
const MIN_HTF_CANDLES = 12;
const HTF_FACTORS = [4, 16] as const;

const TIMEFRAME_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

interface Swing {
  index: number;
  price: number;
  time: number;
  confirmedAtTime: number;
  rejection: number;
}

interface Candidate {
  zoneLow: number;
  zoneHigh: number;
  centre: number;
  reactions: Swing[];
  methods: string[];
  firstTime: number;
  lastTime: number;
  sourceTimeframe: string;
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

function std(values: number[], centre: number): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((total, value) => total + (value - centre) ** 2, 0) / values.length);
}

function referenceAtr(candles: Candle[]): number | null {
  const values = atr(
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    candles.map((candle) => candle.close),
    ATR_PERIOD,
  );
  const usable = values
    .slice(-120)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (usable.length > 0) return median(usable);
  const ranges = candles.map((candle) => candle.high - candle.low).filter((value) => value > 0);
  return median(ranges);
}

function confirmedSwings(candles: Candle[], lookback: number): { highs: Swing[]; lows: Swing[] } {
  const highs: Swing[] = [];
  const lows: Swing[] = [];

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const candle = candles[index] as Candle;
    const confirmedAtTime = (candles[index + lookback] as Candle).time;
    const highWindow = candles.slice(index - lookback, index + lookback + 1).map((item) => item.high);
    const lowWindow = candles.slice(index - lookback, index + lookback + 1).map((item) => item.low);
    const range = candle.high - candle.low;

    const high = candle.high;
    if (high === Math.max(...highWindow) && highWindow.filter((value) => value === high).length === 1) {
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      highs.push({
        index,
        price: high,
        time: candle.time,
        confirmedAtTime,
        rejection: range > 0 ? Math.max(0, Math.min(1, upperWick / range)) : 0,
      });
    }

    const low = candle.low;
    if (low === Math.min(...lowWindow) && lowWindow.filter((value) => value === low).length === 1) {
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      lows.push({
        index,
        price: low,
        time: candle.time,
        confirmedAtTime,
        rejection: range > 0 ? Math.max(0, Math.min(1, lowerWick / range)) : 0,
      });
    }
  }

  return { highs, lows };
}

function collapseInteractions(points: Swing[], lookback: number): Swing[] {
  if (points.length === 0) return [];
  const separation = Math.max(2, Math.floor(lookback / 2));
  const ordered = [...points].sort((a, b) => a.index - b.index);
  const kept: Swing[] = [];
  let group: Swing[] = [ordered[0] as Swing];

  const flush = (): void => {
    const winner = group.reduce((best, point) =>
      point.rejection > best.rejection || (point.rejection === best.rejection && point.index < best.index)
        ? point
        : best,
    );
    kept.push(winner);
  };

  for (const point of ordered.slice(1)) {
    if (point.index - (group[group.length - 1] as Swing).index <= separation) {
      group.push(point);
    } else {
      flush();
      group = [point];
    }
  }
  flush();
  return kept;
}

function clusterPoints(points: Swing[], tolerance: number): Array<{
  centre: number;
  dispersion: number;
  reactions: Swing[];
  firstTime: number;
  lastTime: number;
}> {
  if (points.length === 0) return [];
  const ordered = [...points].sort((a, b) => a.price - b.price || a.index - b.index);
  const groups: Swing[][] = [[ordered[0] as Swing]];

  for (const point of ordered.slice(1)) {
    const group = groups[groups.length - 1] as Swing[];
    const centre = median(group.map((item) => item.price)) as number;
    if (Math.abs(point.price - centre) <= tolerance) group.push(point);
    else groups.push([point]);
  }

  return groups.map((group) => {
    const prices = group.map((item) => item.price);
    const centre = prices.reduce((total, value) => total + value, 0) / prices.length;
    return {
      centre,
      dispersion: std(prices, centre),
      reactions: group,
      firstTime: Math.min(...group.map((item) => item.time)),
      lastTime: Math.max(...group.map((item) => item.time)),
    };
  });
}

function halfWidth(centre: number, dispersion: number, atrRef: number): number {
  const minimum = Math.max(MIN_WIDTH_ATR * atrRef, Math.abs(centre) * 0.0003);
  const fromData = dispersion * 0.75 + 0.05 * atrRef;
  const cap = Math.max(MAX_WIDTH_ATR * atrRef, Math.abs(centre) * 0.02);
  return Math.min(Math.max(minimum, fromData), cap);
}

function zoneStatus(candles: Candle[], low: number, high: number, atrRef: number): ZoneStatus {
  if (candles.length < BREAK_CONFIRM_CLOSES) return 'active';
  const buffer = atrRef * BREAK_BUFFER_ATR;
  const closes = candles.slice(-BREAK_CONFIRM_CLOSES).map((candle) => candle.close);
  const brokeUp = closes.every((close) => close > high + buffer);
  const brokeDown = closes.every((close) => close < low - buffer);
  return brokeUp || brokeDown ? 'broken' : 'active';
}

function buildCandidates(
  candles: Candle[],
  lookback: number,
  tolerance: number,
  atrRef: number,
  sourceTimeframe: string,
): Candidate[] {
  const { highs, lows } = confirmedSwings(candles, lookback);
  const reactions = [...collapseInteractions(highs, lookback), ...collapseInteractions(lows, lookback)];
  const clusters = clusterPoints(reactions, tolerance);

  const candidates: Candidate[] = clusters.map((cluster) => {
    const half = halfWidth(cluster.centre, cluster.dispersion, atrRef);
    return {
      centre: cluster.centre,
      zoneLow: Math.max(0, cluster.centre - half),
      zoneHigh: cluster.centre + half,
      reactions: cluster.reactions,
      methods: ['swing_cluster'],
      firstTime: cluster.firstTime,
      lastTime: cluster.lastTime,
      sourceTimeframe,
    };
  });

  const merged: Candidate[] = [];
  for (const candidate of candidates.sort((a, b) => a.zoneLow - b.zoneLow)) {
    const previous = merged[merged.length - 1];
    if (previous && candidate.zoneLow - previous.zoneHigh <= tolerance * 0.5) {
      const times = new Set(previous.reactions.map((reaction) => reaction.time));
      for (const reaction of candidate.reactions) {
        if (!times.has(reaction.time)) {
          previous.reactions.push(reaction);
          times.add(reaction.time);
        }
      }
      previous.zoneLow = Math.min(previous.zoneLow, candidate.zoneLow);
      previous.zoneHigh = Math.max(previous.zoneHigh, candidate.zoneHigh);
      previous.firstTime = Math.min(previous.firstTime, candidate.firstTime);
      previous.lastTime = Math.max(previous.lastTime, candidate.lastTime);
      previous.centre = (previous.zoneLow + previous.zoneHigh) / 2;
      for (const method of candidate.methods) {
        if (!previous.methods.includes(method)) previous.methods.push(method);
      }
      continue;
    }
    merged.push({ ...candidate, reactions: [...candidate.reactions], methods: [...candidate.methods] });
  }
  return merged;
}

function recencyScore(zone: PriceZone, referenceTime: number, firstTime: number): number {
  const span = Math.max(1, referenceTime - firstTime);
  const recency = 1 - (referenceTime - zone.lastTouchTime) / span;
  return 15 * Math.max(0, Math.min(1, recency));
}

function toZone(
  candidate: Candidate,
  index: number,
  candles: Candle[],
  referencePrice: number,
  atrRef: number,
): PriceZone {
  const low = candidate.zoneLow;
  const high = candidate.zoneHigh;
  const centre = (low + high) / 2;
  const role: ZoneRole = high < referencePrice ? 'support' : low > referencePrice ? 'resistance' : 'both';
  const reactionTimes = [...new Set(candidate.reactions.map((reaction) => reaction.time))].sort((a, b) => a - b);
  let status = zoneStatus(candles, low, high, atrRef);
  if (reactionTimes.length < MIN_REACTIONS && status !== 'broken') status = 'provisional';

  return {
    id: `zone-${index}-${role}`,
    role,
    status,
    zoneLow: round(low),
    zoneHigh: round(high),
    midpoint: round(centre),
    width: round(high - low),
    widthPercent: referencePrice ? round(((high - low) / referencePrice) * 100) : 0,
    distancePercent: referencePrice ? round(((centre - referencePrice) / Math.abs(referencePrice)) * 100) : 0,
    strength: 0,
    strengthMeaning: 'heuristic_0_100',
    methods: [...candidate.methods],
    confluenceCount: candidate.methods.length,
    reactionCount: reactionTimes.length,
    reactionTimes,
    firstTouchTime: candidate.firstTime,
    lastTouchTime: candidate.lastTime,
    sourceTimeframe: candidate.sourceTimeframe,
    confluence: [],
    evidence: [],
    warnings: [],
  };
}

function aggregate(candles: Candle[], factor: number): Candle[] {
  if (candles.length < 2) return [];
  const baseMs = (candles[1] as Candle).time - (candles[0] as Candle).time;
  if (baseMs <= 0) return [];
  const bucketMs = baseMs * factor;
  const lastTime = (candles[candles.length - 1] as Candle).time;
  const buckets = new Map<number, Candle & { count: number }>();

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / bucketMs) * bucketMs;
    if (bucketTime + bucketMs > lastTime) continue;
    const bucket = buckets.get(bucketTime);
    if (!bucket) {
      buckets.set(bucketTime, { ...candle, time: bucketTime, count: 1 });
    } else {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
      bucket.count += 1;
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) => bucket)
    .filter((bucket) => bucket.count >= Math.max(1, Math.floor(factor * 0.7)))
    .map(({ count: _count, ...candle }) => candle);
}

function labelForMinutes(minutes: number): string {
  for (const [label, value] of Object.entries(TIMEFRAME_MINUTES)) {
    if (value === minutes) return label;
  }
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function volumeEvidence(candles: Candle[]): { available: boolean; ratio: number | null } {
  const volumes = candles.map((candle) => candle.volume);
  const nonZero = volumes.filter((value) => value > 0);
  if (nonZero.length < Math.max(10, Math.floor(volumes.length * 0.6))) {
    return { available: false, ratio: null };
  }
  const baseline = median(nonZero.slice(-60));
  if (!baseline || baseline <= 0) return { available: false, ratio: null };
  const last = volumes.slice(-20).filter((value) => value > 0);
  const ratio = last.length > 0 ? last.reduce((total, value) => total + value, 0) / last.length / baseline : null;
  return { available: true, ratio };
}

function overlapConfluence(zones: PriceZone[], htf: HigherTimeframeZones[]): void {
  for (const zone of zones) {
    const overlaps: ZoneConfluence[] = [];
    for (const set of htf) {
      for (const other of set.zones) {
        const overlap = Math.min(zone.zoneHigh, other.zoneHigh) - Math.max(zone.zoneLow, other.zoneLow);
        const narrower = Math.min(zone.zoneHigh - zone.zoneLow, other.zoneHigh - other.zoneLow);
        if (overlap <= 0 || narrower <= 0) continue;
        const ratio = overlap / narrower;
        if (ratio >= 0.3) {
          overlaps.push({
            timeframe: set.timeframe,
            zoneLow: other.zoneLow,
            zoneHigh: other.zoneHigh,
            overlapRatio: round(ratio, 3),
          });
        }
      }
    }
    zone.confluence = overlaps;
    if (overlaps.length > 0 && !zone.methods.includes('htf_confluence')) zone.methods.push('htf_confluence');
    zone.confluenceCount = zone.methods.length + overlaps.length;
  }
}

function scoreZones(
  zones: PriceZone[],
  candidates: Candidate[],
  candles: Candle[],
  referenceTime: number,
  firstTime: number,
): void {
  const volume = volumeEvidence(candles);
  for (const zone of zones) {
    const candidate = candidates.find((item) =>
      Math.abs(round(item.zoneLow) - zone.zoneLow) < 1e-6 && Math.abs(round(item.zoneHigh) - zone.zoneHigh) < 1e-6,
    );
    const rejections = candidate?.reactions.map((reaction) => reaction.rejection) ?? [];
    const reactionScore = Math.min(40, 12 + 8 * (Math.max(1, zone.reactionCount) - 1));
    const rejectionScore =
      20 * (rejections.length > 0 ? rejections.reduce((total, value) => total + value, 0) / rejections.length : 0);
    const confluenceScore = 10 * Math.min(1, zone.confluence.length / 2);
    const volumeScore = volume.available && volume.ratio !== null && volume.ratio >= 1.2 ? 5 : 0;
    zone.strength = round(
      Math.max(0, Math.min(95, reactionScore + rejectionScore + recencyScore(zone, referenceTime, firstTime) + confluenceScore + volumeScore)),
      1,
    );
    zone.evidence = [
      `این ناحیه از ${zone.reactionCount} واکنش مستقلِ سوئینگ تأییدشده ساخته شده است.`,
      `پهنا با نوسان بازار تنظیم شده و ${zone.width} واحد قیمت (${zone.widthPercent}٪) است.`,
    ];
    if (zone.confluence.length > 0) {
      zone.evidence.push(
        `با ناحیه‌های تایم‌فریم بالاتر (${[...new Set(zone.confluence.map((item) => item.timeframe))].join('، ')}) هم‌پوشانی دارد.`,
      );
    }
    if (volume.available && volume.ratio !== null) {
      zone.evidence.push(`میانگین حجم اخیر ${round(volume.ratio, 2)} برابر میانه است.`);
    } else {
      zone.evidence.push('داده حجم قابل اتکا نبود؛ امتیاز حجم در محاسبه لحاظ نشد.');
    }
    if (zone.status === 'provisional') {
      zone.warnings.push('این ناحیه فقط یک واکنش تأییدشده دارد و آزمایشی (provisional) است.');
    }
    if (zone.status === 'broken') {
      zone.warnings.push('دو بسته‌شدن متوالی فراتر از مرز ناحیه ثبت شده؛ ناحیه شکسته‌شده است.');
    }
    if (zone.confluence.length === 0) {
      zone.warnings.push('شواهد تایم‌فریم بالاتر برای این ناحیه موجود نبود.');
    }
  }
}

function emptyZoneSet(referencePrice: number, referenceTime: number, lookback: number, warning: string): ZoneSet {
  return {
    zones: [],
    supports: [],
    resistances: [],
    nearestSupport: null,
    nearestResistance: null,
    referencePrice,
    referenceTime,
    higherTimeframeZones: [],
    method: {
      version: ZONE_METHOD_VERSION,
      atrPeriod: ATR_PERIOD,
      swingLookback: lookback,
      clusterToleranceAtr: CLUSTER_TOLERANCE_ATR,
      minWidthAtr: MIN_WIDTH_ATR,
      maxWidthAtr: MAX_WIDTH_ATR,
      breakBufferAtr: BREAK_BUFFER_ATR,
      breakConfirmCloses: BREAK_CONFIRM_CLOSES,
      minReactions: MIN_REACTIONS,
    },
    warnings: [warning],
  };
}

/** Build the zone set for one candle series. Uses no future bars. */
export function detectZones(
  candles: Candle[],
  timeframe: string,
  swingLookback = 5,
  maxZones = 6,
  includeHtf = true,
): ZoneSet {
  const referencePrice = (candles[candles.length - 1] as Candle | undefined)?.close ?? 0;
  const referenceTime = (candles[candles.length - 1] as Candle | undefined)?.time ?? 0;
  if (candles.length < swingLookback * 2 + 5) {
    return emptyZoneSet(
      referencePrice,
      referenceTime,
      swingLookback,
      'برای ساخت ناحیه قیمتی داده کافی وجود ندارد؛ هیچ ناحیه‌ای ساخته نشد.',
    );
  }

  const firstTime = (candles[0] as Candle).time;
  let atrRef = referenceAtr(candles);
  const warnings: string[] = [];
  if (!atrRef || atrRef <= 0) {
    atrRef = Math.max(referencePrice * 0.002, 1e-9);
    warnings.push('ATR قابل محاسبه نبود؛ پهنا با کسری از قیمت تخمین زده شد.');
  }

  const tolerance = Math.max(atrRef * CLUSTER_TOLERANCE_ATR, referencePrice * 0.0002, 1e-9);
  const candidates = buildCandidates(candles, swingLookback, tolerance, atrRef, timeframe);
  if (candidates.length === 0) {
    return emptyZoneSet(referencePrice, referenceTime, swingLookback, 'هیچ ناحیه‌ای با شواهد کافی شناسایی نشد.');
  }

  const zones = candidates.map((candidate, index) => toZone(candidate, index, candles, referencePrice, atrRef));

  const htfSets: HigherTimeframeZones[] = [];
  if (includeHtf) {
    const baseMinutes = TIMEFRAME_MINUTES[timeframe];
    if (baseMinutes === undefined) {
      warnings.push('تایم‌فریم پایه برای هم‌پوشانی چندزمانی قابل تفسیر نبود.');
    } else {
      for (const factor of HTF_FACTORS) {
        const htfCandles = aggregate(candles, factor);
        if (htfCandles.length < MIN_HTF_CANDLES) continue;
        const label = labelForMinutes(baseMinutes * factor);
        const htf = detectZones(
          htfCandles,
          label,
          Math.max(2, Math.min(swingLookback, 3)),
          4,
          false,
        );
        htfSets.push({ timeframe: label, candleCount: htfCandles.length, zones: htf.zones });
      }
    }
  }

  overlapConfluence(zones, htfSets);
  scoreZones(zones, candidates, candles, referenceTime, firstTime);

  const supports = zones.filter((zone) => zone.midpoint < referencePrice || zone.role === 'both');
  const resistances = zones.filter((zone) => zone.midpoint > referencePrice || zone.role === 'both');

  const rank = (zone: PriceZone): [number, number, number] => [
    zone.status === 'active' ? 0 : zone.status === 'provisional' ? 1 : 2,
    -zone.strength,
    Math.abs(zone.distancePercent),
  ];
  supports.sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  });
  resistances.sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  });

  const broken = zones.filter((zone) => zone.status === 'broken');
  let keptZones = zones;
  if (broken.length > MAX_BROKEN_ZONES) {
    const keep = new Set(
      [...broken].sort((a, b) => b.lastTouchTime - a.lastTouchTime).slice(0, MAX_BROKEN_ZONES).map((zone) => zone.id),
    );
    keptZones = zones.filter((zone) => zone.status !== 'broken' || keep.has(zone.id));
  }

  const finalSupports = supports
    .filter((zone) => keptZones.some((item) => item.id === zone.id))
    .slice(0, maxZones);
  const finalResistances = resistances
    .filter((zone) => keptZones.some((item) => item.id === zone.id))
    .slice(0, maxZones);
  const selectedIds = new Set([...finalSupports, ...finalResistances].map((zone) => zone.id));
  const finalZones = keptZones
    .filter((zone) => selectedIds.has(zone.id))
    .sort((a, b) => a.midpoint - b.midpoint || a.id.localeCompare(b.id));

  return {
    zones: finalZones,
    supports: finalSupports,
    resistances: finalResistances,
    nearestSupport: finalSupports.find((zone) => zone.status !== 'broken') ?? null,
    nearestResistance: finalResistances.find((zone) => zone.status !== 'broken') ?? null,
    referencePrice: round(referencePrice),
    referenceTime,
    higherTimeframeZones: htfSets,
    method: {
      version: ZONE_METHOD_VERSION,
      atrPeriod: ATR_PERIOD,
      swingLookback,
      clusterToleranceAtr: CLUSTER_TOLERANCE_ATR,
      minWidthAtr: MIN_WIDTH_ATR,
      maxWidthAtr: MAX_WIDTH_ATR,
      breakBufferAtr: BREAK_BUFFER_ATR,
      breakConfirmCloses: BREAK_CONFIRM_CLOSES,
      minReactions: MIN_REACTIONS,
    },
    warnings,
  };
}
