import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ApiError } from '../lib/errors.js';
import { success } from '../lib/respond.js';
import { validated } from '../middleware/validate.js';
import type { WatchlistBody } from '../validation/schemas.js';

/** `GET|POST|DELETE /api/watchlist` */
export function createWatchlistController(container: Container) {
  const options = () => ({
    storage: container.storage.description.driver,
    persistent: container.storage.description.persistent,
    ...(container.storage.description.persistent
      ? {}
      : { notices: ['ذخیره‌سازی پایدار فعال نیست؛ لیست پس از راه‌اندازی مجدد سرور خالی می‌شود.'] }),
  });

  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      const items = await container.watchlist.list();
      res.json(success({ items, count: items.length }, options()));
    }),

    add: asyncHandler(async (_req: Request, res: Response) => {
      const body = validated<WatchlistBody>(res);
      const { item, created } = await container.watchlist.add({
        symbol: body.symbol,
        assetClass: body.assetClass,
      });

      res.status(created ? 201 : 200).json(
        success({ item, created }, options()),
      );
    }),

    remove: asyncHandler(async (req: Request, res: Response) => {
      const symbol = req.params.symbol;
      if (!symbol) {
        throw ApiError.badRequest('نماد برای حذف مشخص نشده است.');
      }
      const removed = await container.watchlist.remove(symbol);
      if (!removed) {
        throw ApiError.notFound(`نماد ${symbol} در واچ‌لیست وجود ندارد.`);
      }
      res.json(success({ symbol: symbol.toUpperCase(), removed: true }, options()));
    }),
  };
}
