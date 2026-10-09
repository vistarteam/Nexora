import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import type { Candle } from '../types/domain.js';
import { validated } from '../middleware/validate.js';
import type { MarketDataQuery } from '../validation/schemas.js';

/**
 * `GET /api/market-data`
 *
 * Returns OHLCV candles for the analysis pipeline. Note that this is a *data*
 * endpoint for the engine — the TradingView widget in the UI is a separate,
 * purely visual integration and is never used as a data source.
 */
export function createMarketDataController(container: Container) {
  return {
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
            candles,
            count: candles.length,
          },
          {
            demo: series.source.mode === 'demo',
            storage: container.storage.description.driver,
            ...(series.source.mode === 'demo'
              ? {
                  notices: [
                    'داده‌های این پاسخ دمو و ساختگی هستند و قیمت واقعی بازار نیستند.',
                  ],
                }
              : {}),
          },
        ),
      );
    }),
  };
}
