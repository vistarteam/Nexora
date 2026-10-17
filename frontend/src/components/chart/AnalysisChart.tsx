import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useFormat, useSettings } from '../../context/SettingsContext';
import {
  buildLevelLines,
  buildSwingMarkers,
  buildTrendLine,
  createDrawingId,
  hasVolume,
  loadDrawings,
  overlayColor,
  saveDrawings,
  toCandlestickData,
  toChartTime,
  toHistogramData,
  toLineData,
  windowChangePercent,
} from '../../lib/chart';
import { cn } from '../../lib/cn';
import { pricePrecision, TIMEFRAME_LABELS } from '../../lib/format';
import { describeLiveCandle, describeLiveClose } from '../../lib/live';
import type {
  Candle,
  ChartDrawing,
  ChartPayload,
  ChartPoint,
  TickerSnapshot,
} from '../../types/nexora';
import { Button } from '../ui/Button';
import { RefreshIcon } from '../ui/Icons';

/**
 * Price chart that draws the analysis itself.
 *
 * Every line, marker, level and oscillator here came from the backend engine in
 * `ChartPayload` — the same run that produced the report shown next to it.
 * Nothing is recomputed in the browser, so the chart cannot drift from the
 * numbers the report states: if the legend reads RSI 44.37, the report reads
 * 44.37. That is the property the previous embed could not have, because it
 * charted a different venue, at a different interval, with its own indicators.
 *
 * Rendering is imperative (the library owns its canvas), so series handles live
 * in refs and are re-synced whenever the payload or the layer toggles change.
 * Panes (volume / RSI / MACD) are fixed for the lifetime of a chart instance;
 * changing which panes are visible rebuilds it, which is simpler and safer than
 * mutating a live pane layout.
 */

export interface ChartLayers {
  sma: boolean;
  ema: boolean;
  levels: boolean;
  swings: boolean;
  trend: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
}

export const DEFAULT_CHART_LAYERS: ChartLayers = {
  sma: false,
  ema: true,
  levels: true,
  swings: true,
  trend: true,
  volume: true,
  rsi: true,
  macd: true,
};

type DrawingTool = 'none' | 'hline' | 'trend';

/**
 * The live tape a chart animates from.
 *
 * Passed in rather than fetched here so the pages own the polling lifecycle
 * (they already know the selected instrument) and this component stays a pure
 * renderer of whatever payload and snapshot it is handed.
 */
export interface LiveChartFeed {
  snapshot: TickerSnapshot | null;
  secondsToClose: number | null;
  stale?: boolean;
}

export interface AnalysisChartProps {
  chart: ChartPayload;
  /** Height of the whole chart area, including indicator panes. */
  height?: number;
  className?: string;
  /** Render the layer toggles and the drawing tools. */
  showToolbar?: boolean;
  /** When present, the forming candle and the close countdown update live. */
  live?: LiveChartFeed | null;
}

interface Palette {
  background: string;
  text: string;
  grid: string;
  border: string;
  bull: string;
  bear: string;
  accent: string;
  warn: string;
  info: string;
  volume: { up: string; down: string };
}

/**
 * Chart colours, mirroring the design tokens in `styles/index.css`.
 *
 * The library needs literal colours, so they are duplicated — but only here, and
 * adjacent to the tokens they mirror, so the two cannot drift apart unnoticed.
 */
const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    background: '#0a0f18',
    text: '#8f9cb4',
    grid: '#1d2737',
    border: '#1d2737',
    bull: '#0ecb81',
    bear: '#f6465d',
    accent: '#2dd4bf',
    warn: '#f0b90b',
    info: '#60a5fa',
    volume: { up: 'rgba(14, 203, 129, 0.35)', down: 'rgba(246, 70, 93, 0.35)' },
  },
  light: {
    background: '#f8fafc',
    text: '#475569',
    grid: '#e2e8f0',
    border: '#cbd5e1',
    bull: '#059669',
    bear: '#be123c',
    accent: '#0d9488',
    warn: '#b45309',
    info: '#2563eb',
    volume: { up: 'rgba(5, 150, 105, 0.3)', down: 'rgba(190, 18, 60, 0.3)' },
  },
};

interface LegendValues {
  candle: Candle | null;
  changePercent: number | null;
  overlays: Array<{ id: string; label: string; color: string; value: number | null }>;
  rsi: number | null;
  macd: { macd: number | null; signal: number | null };
}

/** Read a line/histogram series' value out of a crosshair event. */
function seriesValue(
  param: MouseEventParams<Time>,
  series: ISeriesApi<SeriesType> | null | undefined,
): number | null {
  if (!series) return null;
  const data = param.seriesData.get(series as ISeriesApi<SeriesType>) as
    | { value?: number }
    | undefined;
  return typeof data?.value === 'number' ? data.value : null;
}

function candleValue(
  param: MouseEventParams<Time>,
  series: ISeriesApi<'Candlestick'> | null,
): CandlestickData<UTCTimestamp> | null {
  if (!series) return null;
  return (param.seriesData.get(series) as CandlestickData<UTCTimestamp> | undefined) ?? null;
}

export function AnalysisChart({
  chart,
  height = 480,
  className,
  showToolbar = true,
  live = null,
}: AnalysisChartProps): JSX.Element {
  const { settings } = useSettings();
  const format = useFormat();
  const palette = PALETTES[settings.theme];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdRef = useRef<{
    macd: ISeriesApi<'Line'>;
    signal: ISeriesApi<'Line'>;
    histogram: ISeriesApi<'Histogram'>;
  } | null>(null);
  const trendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const overlaySeriesRef = useRef(new Map<string, ISeriesApi<'Line'>>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const drawingLinesRef = useRef<IPriceLine[]>([]);
  const drawingSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  /** The live "now" price line, whose label carries the candle close time. */
  const livePriceLineRef = useRef<IPriceLine | null>(null);
  const lastFittedRef = useRef<string | null>(null);

  const [layers, setLayers] = useState<ChartLayers>(DEFAULT_CHART_LAYERS);
  const [tool, setTool] = useState<DrawingTool>('none');
  const [pendingTrend, setPendingTrend] = useState<ChartPoint | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [legend, setLegend] = useState<LegendValues | null>(null);

  const hasVolumeData = useMemo(() => hasVolume(chart.candles), [chart.candles]);
  const hasRsi = chart.indicators.rsi !== null && chart.indicators.rsi.points.length > 0;
  const hasMacd = chart.indicators.macd !== null && chart.indicators.macd.macd.length > 0;
  const showVolumePane = layers.volume && hasVolumeData;
  const showRsiPane = layers.rsi && hasRsi;
  const showMacdPane = layers.macd && hasMacd;

  const formatPrice = useCallback(
    (value: number) => format.number(value, { precision: pricePrecision(value) }),
    [format],
  );

  const persist = useCallback(
    (next: ChartDrawing[]) => {
      setDrawings(saveDrawings(chart.symbol, chart.timeframe, next));
    },
    [chart.symbol, chart.timeframe],
  );

  /**
   * Everything the imperative chart code reads. Updated on every render, so an
   * effect that runs once still sees current props — the alternative is a
   * dependency list that rebuilds the whole chart on every keystroke.
   */
  const contextRef = useRef({
    chart,
    layers,
    drawings,
    tool,
    pendingTrend,
    palette,
    format,
    commitDrawing: (drawing: ChartDrawing) => persist([...drawings, drawing]),
    setPendingTrend,
  });
  contextRef.current = {
    chart,
    layers,
    drawings,
    tool,
    pendingTrend,
    palette,
    format,
    commitDrawing: (drawing: ChartDrawing) => persist([...drawings, drawing]),
    setPendingTrend,
  };

  /* ---------------------------------------------------------------- *
   * Drawings: load per instrument, write through on every change
   * ---------------------------------------------------------------- */

  useEffect(() => {
    setDrawings(loadDrawings(chart.symbol, chart.timeframe));
    setPendingTrend(null);
  }, [chart.symbol, chart.timeframe]);

  /* ---------------------------------------------------------------- *
   * Series ↔ payload synchronisation
   * ---------------------------------------------------------------- */

  const syncOverlays = useCallback(() => {
    const chartApi = chartRef.current;
    if (!chartApi) return;
    const { chart: payload, layers: activeLayers } = contextRef.current;

    const present = new Set<string>();
    payload.overlays.forEach((overlay, index) => {
      const visible = overlay.kind === 'sma' ? activeLayers.sma : activeLayers.ema;
      present.add(overlay.id);

      let series = overlaySeriesRef.current.get(overlay.id);
      if (!series) {
        series = chartApi.addSeries(LineSeries, {
          color: overlayColor(index),
          lineWidth: 1,
          lineStyle: overlay.kind === 'sma' ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        overlaySeriesRef.current.set(overlay.id, series);
      }
      series.applyOptions({ visible, color: overlayColor(index) });
      series.setData(visible ? toLineData(overlay.points) : []);
    });

    // Drop lines this payload no longer has, so switching instrument or period
    // cannot leave a stale curve behind.
    for (const [id, series] of overlaySeriesRef.current) {
      if (!present.has(id)) {
        chartApi.removeSeries(series);
        overlaySeriesRef.current.delete(id);
      }
    }
  }, []);

  const syncLevels = useCallback(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;
    const { chart: payload, layers: activeLayers, palette: colors, format: fmt } = contextRef.current;

    for (const line of levelLinesRef.current) candleSeries.removePriceLine(line);
    levelLinesRef.current = [];

    if (!activeLayers.levels) return;

    for (const level of buildLevelLines(payload)) {
      const support = level.kind === 'support';
      levelLinesRef.current.push(
        candleSeries.createPriceLine({
          price: level.price,
          color: support ? colors.bull : colors.bear,
          lineWidth: 1,
          lineStyle: LineStyle.SparseDotted,
          // Only the nearest level on each side gets an axis label; ten axis
          // labels would drown out the price scale itself.
          axisLabelVisible: level.nearest,
          title: `${support ? 'حمایت' : 'مقاومت'} ${fmt.number(level.price, {
            precision: pricePrecision(level.price),
          })} · ${fmt.integer(level.touches)} برخورد`,
        }),
      );
    }
  }, []);

  const syncDrawings = useCallback(() => {
    const chartApi = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chartApi || !candleSeries) return;
    const { drawings: active, palette: colors, format: fmt } = contextRef.current;

    for (const line of drawingLinesRef.current) candleSeries.removePriceLine(line);
    drawingLinesRef.current = [];
    for (const series of drawingSeriesRef.current) chartApi.removeSeries(series);
    drawingSeriesRef.current = [];

    for (const drawing of active) {
      if (drawing.kind === 'hline') {
        drawingLinesRef.current.push(
          candleSeries.createPriceLine({
            price: drawing.price,
            color: colors.warn,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `ترسیم ${fmt.number(drawing.price, { precision: pricePrecision(drawing.price) })}`,
          }),
        );
        continue;
      }

      const series = chartApi.addSeries(LineSeries, {
        color: colors.warn,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(toLineData([drawing.from, drawing.to]));
      drawingSeriesRef.current.push(series);
    }
  }, []);

  const applyAll = useCallback(() => {
    const chartApi = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chartApi || !candleSeries) return;
    const { chart: payload, layers: activeLayers, palette: colors } = contextRef.current;

    candleSeries.setData(toCandlestickData(payload.candles));

    const volumeSeries = volumeSeriesRef.current;
    if (volumeSeries) {
      volumeSeries.setData(
        payload.candles
          .filter((candle) => candle.volume > 0)
          .map((candle) => ({
            time: toChartTime(candle.time),
            value: candle.volume,
            color: candle.close >= candle.open ? colors.volume.up : colors.volume.down,
          })),
      );
    }

    const rsiSeries = rsiSeriesRef.current;
    if (rsiSeries) {
      const rsi = payload.indicators.rsi;
      rsiSeries.setData(rsi ? toLineData(rsi.points) : []);
    }

    const macd = macdRef.current;
    if (macd) {
      const data = payload.indicators.macd;
      macd.macd.setData(data ? toLineData(data.macd) : []);
      macd.signal.setData(data ? toLineData(data.signal) : []);
      macd.histogram.setData(
        data ? toHistogramData(data.histogram, { positive: colors.bull, negative: colors.bear }) : [],
      );
    }

    const trendSeries = trendSeriesRef.current;
    if (trendSeries) {
      const points = activeLayers.trend ? buildTrendLine(payload) : [];
      trendSeries.applyOptions({ visible: activeLayers.trend });
      trendSeries.setData(points);
    }

    syncOverlays();

    markersRef.current?.setMarkers(
      activeLayers.swings
        ? buildSwingMarkers(payload, { bull: colors.bull, bear: colors.bear })
        : [],
    );

    syncLevels();
    syncDrawings();

    // Fit only when a different dataset arrives: refitting on every layer toggle
    // would discard the user's zoom.
    const fitKey = `${payload.symbol}|${payload.timeframe}|${payload.candles[0]?.time ?? 0}`;
    if (lastFittedRef.current !== fitKey) {
      lastFittedRef.current = fitKey;
      chartApi.timeScale().fitContent();
    }
  }, [syncDrawings, syncLevels, syncOverlays]);

  /* ---------------------------------------------------------------- *
   * Chart lifecycle — rebuilt only when its panes or the theme change
   * ---------------------------------------------------------------- */

  const paneKey = `${showVolumePane ? 'v' : ''}${showRsiPane ? 'r' : ''}${showMacdPane ? 'm' : ''}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const theme = settings.theme;
    const colors = PALETTES[theme];

    const chartApi = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.border },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: colors.text,
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: colors.border,
        },
        horzLine: {
          color: colors.text,
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: colors.border,
        },
      },
      localization: {
        locale: 'fa-IR',
        priceFormatter: (price: number) => formatPrice(price),
      },
    });
    chartRef.current = chartApi;

    const candleSeries = chartApi.addSeries(CandlestickSeries, {
      upColor: colors.bull,
      downColor: colors.bear,
      borderVisible: false,
      wickUpColor: colors.bull,
      wickDownColor: colors.bear,
      priceLineVisible: false,
    });
    candleSeriesRef.current = candleSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);

    trendSeriesRef.current = chartApi.addSeries(LineSeries, {
      color: colors.warn,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Panes 1..n, created in the order they appear on screen.
    let paneIndex = 1;
    if (showVolumePane) {
      chartApi.addPane();
      volumeSeriesRef.current = chartApi.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      paneIndex += 1;
    }

    if (showRsiPane) {
      chartApi.addPane();
      const rsiSeries = chartApi.addSeries(
        LineSeries,
        {
          color: colors.info,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
      // The conventional bounds are part of reading RSI, so they are always drawn.
      rsiSeries.createPriceLine({
        price: 70,
        color: colors.bear,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '70',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: colors.bull,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: '30',
      });
      rsiSeriesRef.current = rsiSeries;
      paneIndex += 1;
    }

    if (showMacdPane) {
      chartApi.addPane();
      const histogram = chartApi.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex,
      );
      const macdLine = chartApi.addSeries(
        LineSeries,
        {
          color: colors.info,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
      const signalLine = chartApi.addSeries(
        LineSeries,
        {
          color: colors.warn,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
      macdRef.current = { macd: macdLine, signal: signalLine, histogram };
      paneIndex += 1;
    }

    chartApi.panes().forEach((pane, index) => {
      pane.setStretchFactor(index === 0 ? 3 : 1);
    });

    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const ctx = contextRef.current;
      const candle = candleValue(param, candleSeriesRef.current);
      if (!param.time || !candle) {
        setLegend(null);
        return;
      }

      const index = ctx.chart.candles.findIndex(
        (item) => toChartTime(item.time) === (param.time as number),
      );
      const bar = index >= 0 ? (ctx.chart.candles[index] as Candle) : null;
      const previousClose = index > 0 ? (ctx.chart.candles[index - 1] as Candle).close : null;
      const changePercent =
        bar && previousClose !== null && previousClose !== 0
          ? ((bar.close - previousClose) / Math.abs(previousClose)) * 100
          : null;

      setLegend({
        candle: bar,
        changePercent,
        overlays: ctx.chart.overlays.map((overlay, overlayIndex) => ({
          id: overlay.id,
          label: `${overlay.kind.toUpperCase()} ${overlay.period}`,
          color: overlayColor(overlayIndex),
          value: seriesValue(param, overlaySeriesRef.current.get(overlay.id)),
        })),
        rsi: seriesValue(param, rsiSeriesRef.current),
        macd: {
          macd: seriesValue(param, macdRef.current?.macd),
          signal: seriesValue(param, macdRef.current?.signal),
        },
      });
    };

    const onClick = (param: MouseEventParams<Time>) => {
      const ctx = contextRef.current;
      if (ctx.tool === 'none' || !param.point) return;
      const series = candleSeriesRef.current;
      if (!series) return;

      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      const value = Number(price);
      if (!Number.isFinite(value)) return;

      if (ctx.tool === 'hline') {
        ctx.commitDrawing({
          id: createDrawingId('hline', value),
          kind: 'hline',
          price: value,
        });
        return;
      }

      if (!param.time) return;
      const point = { time: Number(param.time) * 1000, value };
      if (!ctx.pendingTrend) {
        ctx.setPendingTrend(point);
        return;
      }
      ctx.commitDrawing({
        id: createDrawingId('trend', value),
        kind: 'trend',
        from: ctx.pendingTrend,
        to: point,
      });
      ctx.setPendingTrend(null);
    };

    chartApi.subscribeCrosshairMove(onCrosshairMove);
    chartApi.subscribeClick(onClick);

    applyAll();

    return () => {
      chartApi.unsubscribeCrosshairMove(onCrosshairMove);
      chartApi.unsubscribeClick(onClick);
      chartApi.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      rsiSeriesRef.current = null;
      macdRef.current = null;
      trendSeriesRef.current = null;
      overlaySeriesRef.current.clear();
      markersRef.current = null;
      levelLinesRef.current = [];
      drawingLinesRef.current = [];
      drawingSeriesRef.current = [];
      livePriceLineRef.current = null;
      lastFittedRef.current = null;
      setLegend(null);
    };
  }, [paneKey, settings.theme, applyAll, formatPrice, showMacdPane, showRsiPane, showVolumePane, height]);

  // Localisation is a cheap `applyOptions`: switching between Persian and Latin
  // numerals must not rebuild the chart.
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { locale: 'fa-IR', priceFormatter: (price: number) => formatPrice(price) },
    });
  }, [formatPrice]);

  // Data, layers and drawings: re-sync the existing series in place.
  useEffect(() => {
    applyAll();
  }, [applyAll, chart, layers, drawings]);

  /**
   * The live tape.
   *
   * Only the forming candle, its volume and the "now" price line move; the
   * moving averages, levels and oscillators are the engine's and are therefore
   * re-synced when the analysis is re-run, not guessed at every second. Drawing
   * a browser-computed EMA here would break the one property this chart exists
   * to guarantee — that every line and number on screen came from the same
   * engine run, so the chart and the report can never disagree.
   */
  useEffect(() => {
    const feed = live;
    const candleSeries = candleSeriesRef.current;
    const candle = feed?.snapshot?.candle ?? null;
    if (!candleSeries || !candle) return;

    // A snapshot older than the newest bar we already hold would make the
    // library throw; skip it rather than corrupt the series.
    const lastKnownTime = contextRef.current.chart.candles.at(-1)?.time ?? 0;
    if (candle.time < lastKnownTime) return;

    candleSeries.update({
      time: toChartTime(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    const volumeSeries = volumeSeriesRef.current;
    if (volumeSeries) {
      volumeSeries.update({
        time: toChartTime(candle.time),
        value: candle.volume,
        color:
          candle.close >= candle.open ? palette.volume.up : palette.volume.down,
      });
    }

    const snapshot = feed?.snapshot ?? null;
    const price = snapshot?.price ?? null;
    if (snapshot === null || price === null || !Number.isFinite(price)) return;

    const title = describeLiveClose(snapshot, feed?.secondsToClose ?? null, format.style);
    const existing = livePriceLineRef.current;
    if (existing) {
      existing.applyOptions({ price, title });
    } else {
      livePriceLineRef.current = candleSeries.createPriceLine({
        price,
        color: palette.accent,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title,
      });
    }
  }, [live, palette.accent, palette.volume.down, palette.volume.up, format.style]);

  // Magnet snapping fights precise line drawing, so relax it while a tool is
  // active and restore it for normal reading.
  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: { mode: tool === 'none' ? CrosshairMode.Magnet : CrosshairMode.Normal },
    });
  }, [tool]);

  const lastCandle = chart.candles[chart.candles.length - 1] ?? null;
  // Prefer the live forming bar: it is the same bar, one second fresher.
  const displayedCandle = legend?.candle ?? live?.snapshot?.candle ?? lastCandle;
  const change = legend ? legend.changePercent : windowChangePercent(chart.candles);
  const nearestSupport = chart.levels?.nearestSupport ?? null;
  const nearestResistance = chart.levels?.nearestResistance ?? null;

  return (
    <div className={cn('w-full', className)}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2.5 py-2">
          <LayerToggle
            label="EMA"
            active={layers.ema}
            disabled={!chart.overlays.some((overlay) => overlay.kind === 'ema')}
            onClick={() => setLayers((current) => ({ ...current, ema: !current.ema }))}
          />
          <LayerToggle
            label="SMA"
            active={layers.sma}
            disabled={!chart.overlays.some((overlay) => overlay.kind === 'sma')}
            onClick={() => setLayers((current) => ({ ...current, sma: !current.sma }))}
          />
          <LayerToggle
            label="سطوح"
            active={layers.levels}
            onClick={() => setLayers((current) => ({ ...current, levels: !current.levels }))}
          />
          <LayerToggle
            label="نقاط چرخش"
            active={layers.swings}
            onClick={() => setLayers((current) => ({ ...current, swings: !current.swings }))}
          />
          <LayerToggle
            label="خط روند"
            active={layers.trend}
            onClick={() => setLayers((current) => ({ ...current, trend: !current.trend }))}
          />

          <span className="mx-1 hidden h-4 w-px bg-border sm:block" />

          <LayerToggle
            label="حجم"
            active={layers.volume}
            disabled={!hasVolumeData}
            disabledHint="این نماد حجم معاملات گزارش نمی‌کند."
            onClick={() => setLayers((current) => ({ ...current, volume: !current.volume }))}
          />
          <LayerToggle
            label="RSI"
            active={layers.rsi}
            disabled={!hasRsi}
            onClick={() => setLayers((current) => ({ ...current, rsi: !current.rsi }))}
          />
          <LayerToggle
            label="MACD"
            active={layers.macd}
            disabled={!hasMacd}
            onClick={() => setLayers((current) => ({ ...current, macd: !current.macd }))}
          />

          <span className="mx-1 hidden h-4 w-px bg-border sm:block" />

          <LayerToggle
            label="ابزار خط افقی"
            active={tool === 'hline'}
            onClick={() => {
              setPendingTrend(null);
              setTool((current) => (current === 'hline' ? 'none' : 'hline'));
            }}
          />
          <LayerToggle
            label="ابزار خط روند"
            active={tool === 'trend'}
            onClick={() => {
              setPendingTrend(null);
              setTool((current) => (current === 'trend' ? 'none' : 'trend'));
            }}
          />

          {drawings.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => persist([])}>
              پاک کردن ترسیم‌ها ({format.integer(drawings.length)})
            </Button>
          ) : null}

          <span className="ms-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => chartRef.current?.timeScale().fitContent()}
              aria-label="بازگشت به نمای کامل"
            >
              <RefreshIcon width={13} height={13} />
              نمای کامل
            </Button>
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-2xs">
        <span className="font-medium text-ink">{chart.name}</span>
        <span className="ltr-data text-ink-subtle">{chart.symbol}</span>
        <span className="text-ink-subtle">{TIMEFRAME_LABELS[chart.timeframe]}</span>
        {displayedCandle ? (
          <span className="ltr-data text-ink-muted">
            O {format.number(displayedCandle.open)} · H {format.number(displayedCandle.high)} · L{' '}
            {format.number(displayedCandle.low)} · C {format.number(displayedCandle.close)}
          </span>
        ) : null}
        {live?.snapshot ? (
          <span
            className={cn(
              'flex items-center gap-1.5',
              live.stale ? 'text-warn' : 'text-bull',
            )}
            title="قیمت و زمان بسته‌شدن کندل جاری، مستقیماً از منبع داده"
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                live.stale ? 'bg-warn' : 'animate-pulse bg-bull',
              )}
            />
            <span className="num text-ink">
              {format.number(live.snapshot.price, {
                precision: pricePrecision(live.snapshot.price ?? 0),
              })}
            </span>
            <span className="num">
              {describeLiveCandle(live.snapshot, live.secondsToClose, format.style)}
            </span>
          </span>
        ) : null}
        {change !== null ? (
          <span
            className={cn(
              'num',
              change > 0 ? 'text-bull' : change < 0 ? 'text-bear' : 'text-ink-muted',
            )}
          >
            {format.percent(change)}
            <span className="ms-1 text-ink-subtle">{legend ? 'کندل' : 'بازه'}</span>
          </span>
        ) : null}
      </div>

      {legend ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-2xs">
          {legend.overlays
            .filter((overlay) => overlay.value !== null)
            .map((overlay) => (
              <span key={overlay.id} className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-3 rounded-full"
                  style={{ backgroundColor: overlay.color }}
                />
                <span className="text-ink-subtle">{overlay.label}</span>
                <span className="num text-ink-muted">{format.number(overlay.value)}</span>
              </span>
            ))}
          {legend.rsi !== null ? (
            <span className="flex items-center gap-1">
              <span className="text-ink-subtle">RSI</span>
              <span className="num text-ink-muted">{format.number(legend.rsi, { precision: 2 })}</span>
            </span>
          ) : null}
          {legend.macd.macd !== null ? (
            <span className="flex items-center gap-1">
              <span className="text-ink-subtle">MACD</span>
              <span className="num text-ink-muted">
                {format.number(legend.macd.macd, { precision: 4 })}
              </span>
              {legend.macd.signal !== null ? (
                <>
                  <span className="text-ink-subtle">سیگنال</span>
                  <span className="num text-ink-muted">
                    {format.number(legend.macd.signal, { precision: 4 })}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full" />

        {chart.candles.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-ink-muted">
            کندلی برای نمایش وجود ندارد.
          </div>
        ) : null}

        {tool !== 'none' ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <p className="mt-2 rounded-full border border-warn/40 bg-base-900/90 px-3 py-1 text-2xs text-warn">
              {tool === 'hline'
                ? 'برای افزودن خط افقی، روی سطح مورد نظر کلیک کنید.'
                : pendingTrend
                  ? 'نقطه دوم خط روند را انتخاب کنید.'
                  : 'نقطه اول خط روند را انتخاب کنید.'}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-2xs text-ink-subtle">
        <span>
          منبع داده: <span className="ltr-data text-ink-muted">{chart.dataSource}</span>
        </span>
        <span>
          کندل‌ها: <span className="num text-ink-muted">{format.integer(chart.candles.length)}</span>
        </span>
        <span>
          موتور:{' '}
          <span className="ltr-data text-ink-muted">
            {chart.engine.id} {chart.engine.version}
          </span>
        </span>
        {nearestSupport ? (
          <span>
            نزدیک‌ترین حمایت: <span className="num text-bull">{format.number(nearestSupport.price)}</span>
          </span>
        ) : null}
        {nearestResistance ? (
          <span>
            نزدیک‌ترین مقاومت:{' '}
            <span className="num text-bear">{format.number(nearestResistance.price)}</span>
          </span>
        ) : null}
      </div>

      {chart.warnings.length > 0 || chart.status !== 'ok' ? (
        <ul className="space-y-1 border-t border-border px-3 py-2 text-2xs text-ink-subtle">
          {chart.reason ? <li className="text-warn">{chart.reason}</li> : null}
          {chart.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LayerToggle({
  label,
  active,
  disabled = false,
  disabledHint,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-2xs font-medium transition',
        active
          ? 'border-accent/50 bg-accent/15 text-accent'
          : 'border-border bg-base-900 text-ink-muted hover:border-border-strong hover:text-ink',
        disabled && 'cursor-not-allowed opacity-40 hover:border-border hover:text-ink-muted',
      )}
    >
      {label}
    </button>
  );
}
