import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Container } from '../src/container.js';
import { AnalysisService } from '../src/services/analysis/analysisService.js';
import { HistoryService } from '../src/services/historyService.js';
import { DemoMarketDataProvider } from '../src/services/marketData/demoProvider.js';
import { MarketDataService } from '../src/services/marketData/index.js';
import { WatchlistService } from '../src/services/watchlistService.js';
import { MemoryStorage } from '../src/storage/memoryStorage.js';

/**
 * Build a fully-wired app on top of in-memory storage and the deterministic
 * demo provider, so the tests exercise the real routers, validation, services
 * and engine bridge without touching the filesystem or the network.
 */
function buildTestApp() {
  const storage = new MemoryStorage('test');
  const marketData = new MarketDataService(new DemoMarketDataProvider({ now: 1_700_000_000_000 }));
  const history = new HistoryService(storage);
  const watchlist = new WatchlistService(storage);
  const analysis = new AnalysisService(marketData, history);
  const container: Container = { storage, marketData, history, watchlist, analysis };
  return createApp(container);
}

let app: ReturnType<typeof buildTestApp>;

beforeEach(() => {
  app = buildTestApp();
});

describe('GET /api/health', () => {
  it('reports every subsystem and flags demo market data', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.service).toBe('nexora-api');
    expect(response.body.data.checks.api).toBe('ok');
    expect(response.body.data.checks.marketData.mode).toBe('demo');
    expect(response.body.data.checks.storage.driver).toBe('memory');
    expect(response.body.data.checks.storage.persistent).toBe(false);
    expect(['available', 'unavailable']).toContain(
      response.body.data.checks.analysisEngine.status,
    );
    expect(response.body.meta.demo).toBe(true);
  });
});

describe('GET /api/config', () => {
  it('exposes defaults and the honesty flags the UI needs', async () => {
    const response = await request(app).get('/api/config').expect(200);
    expect(response.body.data.defaults.symbol).toBe('BINANCE:BTCUSDT');
    expect(response.body.data.marketData.mode).toBe('demo');
    expect(response.body.data.marketData.isDemo).toBe(true);
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
  it('returns candles and labels them as demo', async () => {
    const response = await request(app)
      .get('/api/market-data?symbol=BINANCE:BTCUSDT&assetClass=crypto&timeframe=1h&limit=50')
      .expect(200);
    expect(response.body.data.candles).toHaveLength(50);
    expect(response.body.data.source.mode).toBe('demo');
    expect(response.body.meta.demo).toBe(true);
    expect(response.body.meta.notices.join(' ')).toContain('دمو');
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

  it('produces a report from demo candles and marks it as demo', async () => {
    const response = await request(app).post('/api/analysis').send(validBody).expect(201);
    const { report, saved } = response.body.data;

    expect(response.body.meta.demo).toBe(true);
    expect(saved).toBe(true);
    expect(report.status).toBe('ok');
    expect(report.mode).toBe('demo');
    expect(report.dataSource).toBe('demo');
    expect(report.facts.candleCount).toBeGreaterThanOrEqual(205);
    expect(report.disclaimer).toContain('توصیه سرمایه‌گذاری');
    expect(report.warnings.join(' ')).toContain('دمو');
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
