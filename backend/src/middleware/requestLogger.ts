import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../lib/logger.js';

const log = createLogger('http');

/** Logs method, path, status and duration once the response is finished. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const entry = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    };
    if (res.statusCode >= 500) log.error('request failed', entry);
    else if (res.statusCode >= 400) log.warn('request rejected', entry);
    else log.info('request', entry);
  });

  next();
}
