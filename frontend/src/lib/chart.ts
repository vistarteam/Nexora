import type {
  CandlestickData,
  HistogramData,
  LineData,
  SeriesMarker,
  UTCTimestamp,
} from 'lightweight-charts';
import type {
  Candle,
  ChartDrawing,
  ChartPayload,
  ChartPoint,
  SupportResistanceLevel,
} from '../types/nexora';
import { STORAGE_KEYS, createStorage } from './storage';

/**
 * Mapping between the API's chart payload and the charting library's data
 * shapes, plus the small amount of state the user owns (their drawings).
 *
 * Everything here is a pure function over the payload except the drawing
 * persistence helpers, which own exactly one storage key. Keeping the mapping
 * out of the component makes it unit-testable — in particular the epoch
 * conversion below, where a wrong unit would silently shift every candle to
 * another year.
 */

/**
 * The charting library's `Time` is **seconds** since the epoch, while every
 * timestamp this application moves around is in milliseconds. Converting in one
 * place (here) is what stops a chart from plotting real candles under the wrong
 * dates.
 */
export function toChartTime(epochMs: number): UTCTimestamp {
  return Math.floor(epochMs / 1000) as UTCTimestamp;
}

export function toCandlestickData(candles: Candle[]): CandlestickData<UTCTimestamp>[] {
  return candles.map((candle) => ({
    time: toChartTime(candle.time),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

export function toLineData(points: ChartPoint[]): LineData<UTCTimestamp>[] {
  return points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .map((point) => ({ time: toChartTime(point.time), value: point.value }));
}

/** Histogram bars coloured by sign: rising vs falling momentum is the point. */
export function toHistogramData(
  points: ChartPoint[],
  colors: { positive: string; negative: string },
): HistogramData<UTCTimestamp>[] {
  return points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .map((point) => ({
      time: toChartTime(point.time),
      value: point.value,
      color: point.value >= 0 ? colors.positive : colors.negative,
    }));
}

/**
 * A colour per moving average.
 *
 * Short periods (which hug the price and matter most for a quick read) get the
 * brighter colours; SMA and EMA of the same period are told apart by line style,
 * not colour, so the palette stays readable with all six lines on.
 */
const LINE_COLORS = ['#60a5fa', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185', '#4ade80'] as const;

export function overlayColor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length] as string;
}

export interface LevelLine {
  id: string;
  price: number;
  kind: 'support' | 'resistance';
  touches: number;
  distancePercent: number;
  /** True for the level closest to the current price on its side. */
  nearest: boolean;
}

/**
 * Flatten detected levels into the horizontal lines a chart draws.
 *
 * Both sides are kept (a level below price is only a support while price stays
 * above it), and the nearest one on each side is flagged so the UI can label it
 * differently instead of drawing ten identical lines.
 */
export function buildLevelLines(chart: ChartPayload): LevelLine[] {
  const levels = chart.levels;
  if (!levels) return [];

  const toLine = (
    level: SupportResistanceLevel,
    kind: LevelLine['kind'],
    nearest: SupportResistanceLevel | null,
  ): LevelLine => ({
    id: `${kind}-${level.price}`,
    price: level.price,
    kind,
    touches: level.touches,
    distancePercent: level.distancePercent,
    nearest: nearest !== null && nearest.price === level.price,
  });

  return [
    ...levels.resistances.map((level) => toLine(level, 'resistance', levels.nearestResistance)),
    ...levels.supports.map((level) => toLine(level, 'support', levels.nearestSupport)),
  ];
}

/** Swing markers: a down arrow on a swing high, an up arrow on a swing low. */
export function buildSwingMarkers(
  chart: ChartPayload,
  colors: { bull: string; bear: string },
): SeriesMarker<UTCTimestamp>[] {
  const swings = chart.swings;
  if (!swings) return [];

  const markers: SeriesMarker<UTCTimestamp>[] = [
    ...swings.highs.map((point) => ({
      time: toChartTime(point.time),
      position: 'aboveBar' as const,
      shape: 'arrowDown' as const,
      color: colors.bear,
      price: point.value,
      size: 1,
    })),
    ...swings.lows.map((point) => ({
      time: toChartTime(point.time),
      position: 'belowBar' as const,
      shape: 'arrowUp' as const,
      color: colors.bull,
      price: point.value,
      size: 1,
    })),
  ];

  // The library requires markers in ascending time order.
  return markers.sort((a, b) => (a.time as number) - (b.time as number));
}

/** Endpoints of the fitted trend line, ready to plot. */
export function buildTrendLine(chart: ChartPayload): LineData<UTCTimestamp>[] {
  const regression = chart.trend?.regression;
  if (!regression) return [];
  return [toLineData([regression.from])[0], toLineData([regression.to])[0]].filter(
    (point): point is LineData<UTCTimestamp> => point !== undefined,
  );
}

/** The volume pane is pointless when the venue reports no volume (e.g. spot FX). */
export function hasVolume(candles: Candle[]): boolean {
  return candles.some((candle) => candle.volume > 0);
}

/** Percentage change across the whole window, used by the chart legend. */
export function windowChangePercent(candles: Candle[]): number | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last || first.close === 0) return null;
  return ((last.close - first.close) / Math.abs(first.close)) * 100;
}

/* ------------------------------------------------------------------ *
 * User drawings (persisted per symbol + timeframe)
 * ------------------------------------------------------------------ */

/** One storage entry holds every instrument's drawings, keyed by `symbol|tf`. */
export function drawingKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

/** Upper bound per instrument, so a stuck click loop cannot fill storage. */
export const MAX_DRAWINGS = 40;

type DrawingMap = Record<string, ChartDrawing[]>;

export function loadDrawings(symbol: string, timeframe: string): ChartDrawing[] {
  const store = createStorage().get<DrawingMap>(STORAGE_KEYS.chartDrawings, {});
  return store[drawingKey(symbol, timeframe)] ?? [];
}

export function saveDrawings(
  symbol: string,
  timeframe: string,
  drawings: ChartDrawing[],
): ChartDrawing[] {
  const storage = createStorage();
  const store = storage.get<DrawingMap>(STORAGE_KEYS.chartDrawings, {});
  const trimmed = drawings.slice(-MAX_DRAWINGS);
  storage.set(STORAGE_KEYS.chartDrawings, { ...store, [drawingKey(symbol, timeframe)]: trimmed });
  return trimmed;
}

/**
 * Monotonic counter behind {@link createDrawingId}.
 *
 * A timestamp alone is not enough: two clicks in the same millisecond at the
 * same price would produce the same id, and two drawings sharing an id would
 * share a React key and could be removed together. The counter makes uniqueness
 * a property of the generator rather than of how fast a user clicks.
 */
let drawingSequence = 0;

/** An id for a user drawing, unique within the session. */
export function createDrawingId(prefix: string, seed: number): string {
  drawingSequence += 1;
  return [
    prefix,
    Date.now().toString(36),
    Math.abs(Math.round(seed)).toString(36),
    drawingSequence.toString(36),
  ].join('-');
}
