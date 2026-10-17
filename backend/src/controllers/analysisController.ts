import type { Request, Response } from 'express';
import type { Container } from '../container.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { success } from '../lib/respond.js';
import { validated } from '../middleware/validate.js';
import type { AnalysisBody } from '../validation/schemas.js';

/**
 * `POST /api/analysis`
 *
 * Runs the full pipeline (market data → analysis engine → report) and returns
 * the composed report. A successful HTTP response does not imply a successful
 * analysis: `data.report.status` carries `ok`, `insufficient_data` or
 * `unavailable`, and the UI renders each of those distinctly.
 *
 * With `includeChart: true` the response also carries `data.chart`, the chart
 * payload computed from the *same* candles in the *same* engine run, so the
 * drawn chart and the report cannot disagree about the newest bar.
 */
export function createAnalysisController(container: Container) {
  return {
    create: asyncHandler(async (_req: Request, res: Response) => {
      const body = validated<AnalysisBody>(res);

      const outcome = await container.analysis.run({
        symbol: body.symbol,
        assetClass: body.assetClass,
        timeframe: body.timeframe,
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
        save: body.save ?? true,
        includeChart: body.includeChart ?? false,
      });

      res.status(201).json(
        success(
          {
            report: outcome.report,
            chart: outcome.chart,
            saved: outcome.saved,
            durationMs: outcome.durationMs,
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
