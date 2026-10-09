import { z } from 'zod';

/** Shared primitives so the rules stay identical across endpoints. */

export const assetClassSchema = z.enum(['crypto', 'forex', 'stocks']);

export const timeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);

/**
 * Symbols are `EXCHANGE:TICKER` or a bare ticker. Deliberately permissive
 * (the catalog can change) but bounded, so nothing exotic reaches a provider.
 */
export const symbolSchema = z
  .string()
  .trim()
  .min(2, 'نماد باید حداقل ۲ کاراکتر باشد.')
  .max(32, 'نماد نمی‌تواند بیش از ۳۲ کاراکتر باشد.')
  .regex(/^[A-Za-z0-9.:_\-/]+$/, 'نماد شامل کاراکترهای مجاز نیست.');

export const querySchema = z.object({
  assetClass: assetClassSchema.optional(),
  q: z.string().trim().max(64).optional(),
});

export const marketDataQuerySchema = z.object({
  symbol: symbolSchema,
  assetClass: assetClassSchema.default('crypto'),
  timeframe: timeframeSchema.default('1h'),
  limit: z.coerce.number().int().min(10).max(1000).default(300),
});

export const analysisBodySchema = z.object({
  symbol: symbolSchema,
  assetClass: assetClassSchema,
  timeframe: timeframeSchema,
  limit: z.coerce.number().int().min(60).max(1000).optional(),
  save: z.boolean().optional(),
});

export const watchlistBodySchema = z.object({
  symbol: symbolSchema,
  assetClass: assetClassSchema,
});

export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'شناسه الزامی است.').max(128),
});

export const symbolParamSchema = z.object({
  symbol: symbolSchema,
});

export type MarketDataQuery = z.infer<typeof marketDataQuerySchema>;
export type AnalysisBody = z.infer<typeof analysisBodySchema>;
export type WatchlistBody = z.infer<typeof watchlistBodySchema>;
export type MarketsQuery = z.infer<typeof querySchema>;
export type LimitQuery = z.infer<typeof limitQuerySchema>;
