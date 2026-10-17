import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Container } from '../src/container.js';
import { AnalysisService } from '../src/services/analysis/analysisService.js';
import { HistoryService } from '../src/services/historyService.js';
import { MarketDataService } from '../src/services/marketData/index.js';
import { WatchlistService } from '../src/services/watchlistService.js';
import { MemoryStorage } from '../src/storage/memoryStorage.js';
import { TestCandleProvider } from './support/testCandleProvider.js';

/**
 * Build a fully-wired app on top of in-memory storage and an offline test double
 * for the market-data layer, so the tests exercise the real routers, validation,
 * services and engine bridge without touching the filesystem or the network.
 */
function buildTestApp() {
  const storage = new MemoryStorage('test');
  const marketData = new MarketDataService(new TestCandleProvider(1_700_000_000_000));
  const history = new HistoryService(storage);
  const watchlist = new WatchlistService(storage);
  const analysis = new AnalysisService(marketData, history);
  const container: Container = { storage, marketData, history, watchlist, analysis };
  return createApp(container);
}

/** The newest plotted value of a chart line, for comparing against the report. */
function lastValue(points: Array<{ time: number; value: number }>): number {
  return points[points.length - 1]!.value;
}

let app: ReturnType<typeof buildTestApp>;

beforeEach(() => {
  app = buildTestApp();
});

describe('GET /api/health', () => {
  it('reports every subsystem and names the configured data source', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.service).toBe('nexora-api');
    expect(response.body.data.checks.api).toBe('ok');
    expect(response.body.data.checks.marketData.mode).toBe('live');
    expect(response.body.data.checks.storage.driver).toBe('memory');
    expect(response.body.data.checks.storage.persistent).toBe(false);
    expect(['available', 'unavailable']).toContain(
      response.body.data.checks.analysisEngine.status,
    );
    expect(response.body.meta).not.toHaveProperty('demo');
  });
});

describe('GET /api/config', () => {
  it('exposes defaults and the honesty flags the UI needs', async () => {
    const response = await request(app).get('/api/config').expect(200);
    expect(response.body.data.defaults.symbol).toBe('BINANCE:BTCUSDT');
    expect(response.body.data.marketData.mode).toBe('live');
    expect(response.body.data.marketData).not.toHaveProperty('isDemo');
    expect(response.body.data.assetClasses).toHaveLength(3);
    expect(response.body.data.timeframes).toContain('1h');
  });
});

describe('GET /api/markets', () => {
  it('returns the catalog', async () => {
    const response = await request(app).get('/api/markets').expect(200);
    expect(response.body.data.items.length).toBeGreaterThan(10);
    expect(response.body.data.total).toBe(response.body.data.items.length);
  });

  it('filters by asset class', async () => {
    const response = await request(app).get('/api/markets?assetClass=forex').expect(200);
    expect(response.body.data.items.length).toBeGreaterThan(0);
    for (const item of response.body.data.items) {
      expect(item.assetClass).toBe('forex');
    }
  });

  it('filters by free-text query', async () => {
    const response = await request(app).get('/api/markets?q=btc').expect(200);
    expect(response.body.data.items.some((item: { symbol: string }) => item.symbol === 'BINANCE:BTCUSDT')).toBe(true);
  });

  it('rejects an unknown asset class with a validation error', async () => {
    const response = await request(app).get('/api/markets?assetClass=options').expect(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('GET /api/market-data', () => {
  it('returns candles and names their source', async () => {
    const response = await request(app)
      .get('/api/market-data?symbol=BINANCE:BTCUSDT&assetClass=crypto&timeframe=1h&limit=50')
      .expect(200);
    expect(response.body.data.candles).toHaveLength(50);
    expect(response.body.data.source.mode).toBe('live');
    expect(response.body.data.source.provider).toBe('test');
    expect(response.body.meta).not.toHaveProperty('demo');
  });

  it('requires a symbol', async () => {
    const response = await request(app).get('/api/market-data').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((issue: { path: string }) => issue.path)).toContain(
      'query.symbol',
    );
  });

  it('rejects a limit below the minimum', async () => {
    await request(app).get('/api/market-data?symbol=BINANCE:BTCUSDT&limit=2').expect(400);
  });

  it('rejects a malformed symbol', async () => {
    await request(app).get('/api/market-data?symbol=@@@').expect(400);
  });
});

describe('POST /api/analysis', () => {
  const validBody = {
    symbol: 'BINANCE:BTCUSDT',
    assetClass: 'crypto',
    timeframe: '1h',
  };

  it('produces a complete report and records where its candles came from', async () => {
    const response = await request(app).post('/api/analysis').send(validBody).expect(201);
    const { report, saved } = response.body.data;

    expect(response.body.meta).not.toHaveProperty('demo');
    expect(saved).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.mode).toBe('live');
    expect(report.dataSource).toBe('test');
    expect(report.facts.candleCount).toBeGreaterThanOrEqual(205);
    expect(report.disclaimer).toContain('توصیه سرمایه‌گذاری');
    expect(['python', 'typescript-fallback']).toContain(report.engine.id);
    expect(report.scenarios.length).toBeGreaterThan(0);
  });

  it('separates facts from interpretation', async () => {
    const response = await request(app).post('/api/analysis').send(validBody).expect(201);
    const { report } = response.body.data;
    expect(typeof report.facts.indicators.rsi.value).toBe('number');
    expect(typeof report.interpretation.summary).toBe('string');
    expect(report.interpretation.caveats.length).toBeGreaterThan(0);
  });

  it('can skip persistence', async () => {
    await request(app).post('/api/analysis').send({ ...validBody, save: false }).expect(201);
    const history = await request(app).get('/api/history').expect(200);
    expect(history.body.data.total).toBe(0);
  });

  it('rejects a body with no symbol', async () => {
    const response = await request(app)
      .post('/api/analysis')
      .send({ assetClass: 'crypto', timeframe: '1h' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown timeframe', async () => {
    await request(app).post('/api/analysis').send({ ...validBody, timeframe: '3h' }).expect(400);
  });

  it('returns no chart unless it is asked for', async () => {
    const response = await request(app).post('/api/analysis').send(validBody).expect(201);
    expect(response.body.data.chart).toBeNull();
  });

  it('draws the same analysis it reports when the chart is requested', async () => {
    const response = await request(app)
      .post('/api/analysis')
      .send({ ...validBody, includeChart: true })
      .expect(201);

    const { report, chart } = response.body.data;
    expect(report.status).toBe('ok');
    expect(chart).not.toBeNull();

    // Same run, same candles, same venue: the chart cannot tell a different
    // story from the report sitting next to it.
    expect(chart.symbol).toBe(report.symbol);
    expect(chart.timeframe).toBe(report.timeframe);
    expect(chart.dataSource).toBe(report.dataSource);
    expect(chart.engine.id).toBe(report.engine.id);
    expect(chart.candles.length).toBe(report.facts.candleCount);
    expect(chart.candles[chart.candles.length - 1]).toEqual(report.facts.lastCandle);

    // The newest point of each line is the number the report states.
    expect(lastValue(chart.indicators.rsi.points)).toBeCloseTo(report.facts.indicators.rsi.value, 2);
    expect(lastValue(chart.indicators.macd.macd)).toBeCloseTo(report.facts.indicators.macd.macd, 5);
    expect(lastValue(chart.indicators.macd.signal)).toBeCloseTo(report.facts.indicators.macd.signal, 5);
    expect(lastValue(chart.indicators.macd.histogram)).toBeCloseTo(
      report.facts.indicators.macd.histogram,
      5,
    );
    expect(lastValue(chart.indicators.atr.points)).toBeCloseTo(report.facts.indicators.atr.value, 5);

    for (const snapshot of report.facts.indicators.sma) {
      const overlay = chart.overlays.find((item: { id: string }) => item.id === `sma${snapshot.period}`);
      expect(overlay).toBeDefined();
      expect(lastValue(overlay.points)).toBeCloseTo(snapshot.value, 5);
    }
  });
});

describe('GET /api/chart', () => {
  it('returns candles plus every overlay the engine derived from them', async () => {
    const response = await request(app)
      .get('/api/chart?symbol=BINANCE:BTCUSDT&assetClass=crypto&timeframe=1h')
      .expect(200);
    const chart = response.body.data;

    expect(chart.status).toBe('ok');
    expect(chart.mode).toBe('live');
    expect(chart.dataSource).toBe('test');
    expect(chart.candles.length).toBeGreaterThanOrEqual(205);
    expect(chart.overlays.map((overlay: { id: string }) => overlay.id)).toEqual(
      expect.arrayContaining(['sma20', 'sma50', 'sma200', 'ema9', 'ema21', 'ema55']),
    );
    expect(chart.indicators.rsi.period).toBe(14);
    expect(chart.indicators.macd).toMatchObject({ fast: 12, slow: 26, signalPeriod: 9 });

    // Every plotted point must sit on a real candle, otherwise the line is drawn
    // against a time axis that does not exist.
    const times = new Set(chart.candles.map((candle: { time: number }) => candle.time));
    const plotted = [
      ...chart.overlays.flatMap((overlay: { points: unknown[] }) => overlay.points),
      ...chart.indicators.rsi.points,
      ...chart.indicators.macd.histogram,
      ...chart.indicators.atr.points,
    ] as Array<{ time: number; value: number }>;
    expect(plotted.length).toBeGreaterThan(0);
    for (const point of plotted) {
      expect(times.has(point.time)).toBe(true);
      expect(Number.isFinite(point.value)).toBe(true);
    }
  });

  it('keeps detected levels on the correct side of the last price', async () => {
    const response = await request(app)
      .get('/api/chart?symbol=BINANCE:BTCUSDT&assetClass=crypto&timeframe=1h')
      .expect(200);
    const chart = response.body.data;
    const lastClose = chart.candles[chart.candles.length - 1].close;

    expect(chart.levels).not.toBeNull();
    for (const support of chart.levels.supports) {
      expect(support.price).toBeLessThan(lastClose);
    }
    for (const resistance of chart.levels.resistances) {
      expect(resistance.price).toBeGreaterThan(lastClose);
    }
    if (chart.levels.nearestSupport) {
      expect(chart.levels.nearestSupport.distancePercent).toBeLessThan(0);
    }
    if (chart.levels.nearestResistance) {
      expect(chart.levels.nearestResistance.distancePercent).toBeGreaterThan(0);
    }
  });

  it('anchors swing markers to the wick they were detected on', async () => {
    const response = await request(app)
      .get('/api/chart?symbol=BINANCE:BTCUSDT&assetClass=crypto&timeframe=1h')
      .expect(200);
    const chart = response.body.data;
    const byTime = new Map(
      chart.candles.map((candle: { time: number; high: number; low: number }) => [candle.time, candle]),
    );

    for (const point of chart.swings?.highs ?? []) {
      expect(point.value).toBe((byTime.get(point.time) as { high: number }).high);
    }
    for (const point of chart.swings?.lows ?? []) {
      expect(point.value).toBe((byTime.get(point.time) as { low: number }).low);
    }
  });

  it('rejects a request without a symbol', async () => {
    const response = await request(app).get('/api/chart?assetClass=crypto').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('watchlist', () => {
  it('starts empty', async () => {
    const response = await request(app).get('/api/watchlist').expect(200);
    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.count).toBe(0);
  });

  it('adds, lists and removes a symbol', async () => {
    const created = await request(app)
      .post('/api/watchlist')
      .send({ symbol: 'BINANCE:ETHUSDT', assetClass: 'crypto' })
      .expect(201);
    expect(created.body.data.created).toBe(true);
    expect(created.body.data.item.name).toBe('اتریوم / تتر');

    const listed = await request(app).get('/api/watchlist').expect(200);
    expect(listed.body.data.items).toHaveLength(1);

    // Re-adding is idempotent, not an error.
    const again = await request(app)
      .post('/api/watchlist')
      .send({ symbol: 'binance:ethusdt', assetClass: 'crypto' })
      .expect(200);
    expect(again.body.data.created).toBe(false);

    await request(app).delete('/api/watchlist/BINANCE:ETHUSDT').expect(200);
    const afterDelete = await request(app).get('/api/watchlist').expect(200);
    expect(afterDelete.body.data.items).toHaveLength(0);
  });

  it('returns 404 when removing something that is not listed', async () => {
    const response = await request(app).delete('/api/watchlist/BINANCE:DOGEUSDT').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a missing assetClass', async () => {
    await request(app).post('/api/watchlist').send({ symbol: 'BINANCE:BTCUSDT' }).expect(400);
  });
});

describe('history', () => {
  it('returns saved reports newest-first, then serves one by id', async () => {
    const first = await request(app)
      .post('/api/analysis')
      .send({ symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto', timeframe: '1h' })
      .expect(201);
    const second = await request(app)
      .post('/api/analysis')
      .send({ symbol: 'BINANCE:ETHUSDT', assetClass: 'crypto', timeframe: '4h' })
      .expect(201);

    const list = await request(app).get('/api/history').expect(200);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.items[0].id).toBe(second.body.data.report.id);
    expect(list.body.data.items[1].id).toBe(first.body.data.report.id);
    expect(list.body.data.items[0].price).toBeTypeOf('number');

    const detail = await request(app)
      .get(`/api/history/${first.body.data.report.id}`)
      .expect(200);
    expect(detail.body.data.report.symbol).toBe('BINANCE:BTCUSDT');

    await request(app).delete(`/api/history/${first.body.data.report.id}`).expect(200);
    const afterDelete = await request(app).get('/api/history').expect(200);
    expect(afterDelete.body.data.total).toBe(1);
  });

  it('404s for an unknown report id', async () => {
    const response = await request(app).get('/api/history/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('unknown routes', () => {
  it('returns the standard failure envelope', async () => {
    const response = await request(app).get('/api/nope').expect(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.meta.generatedAt).toBeTruthy();
  });
});
