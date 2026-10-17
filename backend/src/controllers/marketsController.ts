import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import { ASSET_CLASSES, TIMEFRAMES, type AssetClass } from '../types/domain.js';
import type { MarketsPayload } from '../types/api.js';
import { MARKET_CATALOG, listMarkets } from '../services/marketData/catalog.js';
import { validated } from '../middleware/validate.js';
import type { MarketsQuery } from '../validation/schemas.js';

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  crypto: 'ارز دیجیتال',
  forex: 'فارکس',
  stocks: 'سهام',
};

/** `GET /api/markets` — the static instrument catalog with filtering. */
export function createMarketsController(container: Container) {
  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      const query = validated<MarketsQuery>(res);
      const items = listMarkets({
        ...(query.assetClass ? { assetClass: query.assetClass } : {}),
        ...(query.q ? { query: query.q } : {}),
      });

      const payload: MarketsPayload = {
        items: items.map((item) => ({
          symbol: item.symbol,
          tvSymbol: item.tvSymbol,
          name: item.name,
          assetClass: item.assetClass,
          venue: item.venue,
        })),
        assetClasses: ASSET_CLASSES.map((assetClass) => ({
          id: assetClass,
          label: ASSET_CLASS_LABELS[assetClass],
          count: MARKET_CATALOG.filter((item) => item.assetClass === assetClass).length,
        })),
        total: items.length,
      };

      res.json(success(payload, { storage: container.storage.description.driver }));
    }),

    /**
     * `GET /api/config` — everything the frontend needs to render itself
     * honestly: which provider serves data, which assets/timeframes exist, and
     * whether persistence is durable.
     */
    bootstrap: asyncHandler(async (_req: Request, res: Response) => {
      const provider = container.marketData.providerInfo;
      res.json(
        success(
          {
            defaults: {
              symbol: config.defaults.symbol,
              timeframe: config.defaults.timeframe,
            },
            assetClasses: ASSET_CLASSES.map((assetClass) => ({
              id: assetClass,
              label: ASSET_CLASS_LABELS[assetClass],
            })),
            timeframes: TIMEFRAMES,
            marketData: {
              provider: provider.id,
              label: provider.label,
              mode: provider.mode,
              supports: provider.supports,
            },
            analysis: {
              engine: 'python',
              typeScriptFallbackEnabled: config.analysisEngine.allowTypeScriptFallback,
              disclaimer:
                'تحلیل‌های این پلتفرم فنی و خودکار هستند و توصیه سرمایه‌گذاری محسوب نمی‌شوند.',
            },
            storage: {
              driver: container.storage.description.driver,
              persistent: container.storage.description.persistent,
            },
          },
          {
            storage: container.storage.description.driver,
            persistent: container.storage.description.persistent,
          },
        ),
      );
    }),
  };
}
