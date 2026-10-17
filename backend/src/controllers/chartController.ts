import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import { validated } from '../middleware/validate.js';
import type { MarketDataQuery } from '../validation/schemas.js';

/**
 * `GET /api/chart`
 *
 * Returns candles plus every overlay, oscillator, level and swing point the
 * analysis engine derived from them — the input a chart needs to draw the
 * analysis itself rather than a picture that merely sits next to it.
 *
 * Candles always come back, even when the engine could not produce a series
 * (`status: "insufficient_data"`): the chart then shows real price action and the
 * engine's own explanation, instead of nothing.
 */
export function createChartController(container: Container) {
  return {
    get: asyncHandler(async (_req: Request, res: Response) => {
      const query = validated<MarketDataQuery>(res);

      const payload = await container.analysis.chart({
        symbol: query.symbol,
        assetClass: query.assetClass,
        timeframe: query.timeframe,
        limit: query.limit,
      });

      res.json(
        success(payload, {
          storage: container.storage.description.driver,
        }),
      );
    }),
  };
}
