import { Router } from 'express';
import type { Container } from '../container.js';
import { createAnalysisController } from '../controllers/analysisController.js';
import { createChartController } from '../controllers/chartController.js';
import { createHealthController } from '../controllers/healthController.js';
import { createHistoryController } from '../controllers/historyController.js';
import { createMarketDataController } from '../controllers/marketDataController.js';
import { createMarketsController } from '../controllers/marketsController.js';
import { createWatchlistController } from '../controllers/watchlistController.js';
import { validate } from '../middleware/validate.js';
import {
  analysisBodySchema,
  idParamSchema,
  limitQuerySchema,
  marketDataQuerySchema,
  querySchema,
  symbolParamSchema,
  tickerQuerySchema,
  watchlistBodySchema,
} from '../validation/schemas.js';

/**
 * Builds the `/api` router.
 *
 * The container is injected here and closed over by the controllers, so no
 * module reaches for a global singleton and tests can build the router with
 * in-memory storage and an offline test double for market data.
 */
export function createApiRouter(container: Container): Router {
  const router = Router();

  const health = createHealthController(container);
  const markets = createMarketsController(container);
  const marketData = createMarketDataController(container);
  const analysis = createAnalysisController(container);
  const chart = createChartController(container);
  const watchlist = createWatchlistController(container);
  const history = createHistoryController(container);

  // ---- Meta ----
  router.get('/health', health.get);
  router.get('/config', markets.bootstrap);

  // ---- Catalogs ----
  router.get('/markets', validate(querySchema, 'query'), markets.list);

  // ---- Market data ----
  router.get('/market-data', validate(marketDataQuerySchema, 'query'), marketData.get);
  router.get('/ticker', validate(tickerQuerySchema, 'query'), marketData.ticker);

  // ---- Analysis ----
  router.get('/chart', validate(marketDataQuerySchema, 'query'), chart.get);
  router.post('/analysis', validate(analysisBodySchema, 'body'), analysis.create);

  // ---- Watchlist ----
  router.get('/watchlist', watchlist.list);
  router.post('/watchlist', validate(watchlistBodySchema, 'body'), watchlist.add);
  router.delete('/watchlist/:symbol', validate(symbolParamSchema, 'params'), watchlist.remove);

  // ---- History ----
  router.get('/history', validate(limitQuerySchema, 'query'), history.list);
  router.get('/history/:id', validate(idParamSchema, 'params'), history.get);
  router.delete('/history/:id', validate(idParamSchema, 'params'), history.remove);

  return router;
}
