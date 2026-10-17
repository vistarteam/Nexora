import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ApiError } from '../lib/errors.js';
import { success } from '../lib/respond.js';
import { validated } from '../middleware/validate.js';
import type { LimitQuery } from '../validation/schemas.js';

/** `GET|DELETE /api/history` — saved analysis reports. */
export function createHistoryController(container: Container) {
  const storageMeta = () => ({
    storage: container.storage.description.driver,
    persistent: container.storage.description.persistent,
    ...(container.storage.description.persistent
      ? {}
      : {
          notices: [
            'ذخیره‌سازی پایدار فعال نیست؛ تاریخچه پس از راه‌اندازی مجدد سرور از دست می‌رود.',
          ],
        }),
  });

  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      const query = validated<LimitQuery>(res);
      const [items, total] = await Promise.all([
        container.history.list(query.limit),
        container.history.count(),
      ]);
      res.json(success({ items, count: items.length, total }, storageMeta()));
    }),

    get: asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id;
      if (!id) throw ApiError.badRequest('شناسه گزارش مشخص نشده است.');
      const report = await container.history.get(id);
      if (!report) throw ApiError.notFound(`گزارشی با شناسه ${id} یافت نشد.`);
      res.json(success({ report }, storageMeta()));
    }),

    remove: asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id;
      if (!id) throw ApiError.badRequest('شناسه گزارش مشخص نشده است.');
      const removed = await container.history.remove(id);
      if (!removed) throw ApiError.notFound(`گزارشی با شناسه ${id} یافت نشد.`);
      res.json(success({ id, removed: true }, storageMeta()));
    }),
  };
}
