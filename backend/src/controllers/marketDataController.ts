import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import type { Candle } from '../types/domain.js';
import { validated } from '../middleware/validate.js';
import type { MarketDataQuery, TickerQuery } from '../validation/schemas.js';

/**
 * `GET /api/market-data`
 *
 * Returns OHLCV candles for the analysis pipeline. Note that this is a *data*
 * endpoint for the engine — the TradingView widget in the UI is a separate,
 * purely visual integration and is never used as a data source.
 */
export function createMarketDataController(container: Container) {
  return {
    /**
     * `GET /api/ticker`
     *
     * A one-second-granularity view of one instrument: the newest price, the
     * forming candle and the instant that candle closes. Separate from
     * `/api/market-data` because a live chart polls this every second, and
     * re-sending three hundred candles each time would be wasteful — and, for a
     * free upstream, rude.
     */
    ticker: asyncHandler(async (_req: Request, res: Response) => {
      const query = validated<TickerQuery>(res);

      const snapshot = await container.marketData.ticker({
        symbol: query.symbol,
        assetClass: query.assetClass,
        timeframe: query.timeframe,
      });

      res.json(success(snapshot, { storage: container.storage.description.driver }));
    }),

    get: asyncHandler(async (_req: Request, res: Response) => {
      const query = validated<MarketDataQuery>(res);

      const series = await container.marketData.fetchCandles({
        symbol: query.symbol,
        assetClass: query.assetClass,
        timeframe: query.timeframe,
        limit: query.limit,
      });

      const candles: Candle[] = series.candles;

      res.json(
        success(
          {
            symbol: series.symbol,
            tvSymbol: series.tvSymbol,
            assetClass: series.assetClass,
            timeframe: series.timeframe,
            source: series.source,
            ...(series.lastCandleStatus
              ? { lastCandleStatus: series.lastCandleStatus }
              : {}),
            candles,
            count: candles.length,
          },
          { storage: container.storage.description.driver },
        ),
      );
    }),
  };
}
