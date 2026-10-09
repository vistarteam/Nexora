import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { failure } from '../lib/respond.js';

const log = createLogger('http');

/** Terminal middleware for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(
      failure('NOT_FOUND', `مسیر ${req.method} ${req.originalUrl} یافت نشد.`),
    );
}

/**
 * Convert anything thrown in a handler into a consistent JSON envelope.
 *
 * Internal failures are logged in full and reported generically: stack traces
 * and driver errors are never sent to a browser.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestContext = {
    method: req.method,
    path: req.originalUrl,
  };

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      log.error(error.message, { ...requestContext, code: error.code, ...error.logContext });
    } else {
      log.warn(error.message, { ...requestContext, code: error.code, ...error.logContext });
    }
    res
      .status(error.statusCode)
      .json(failure(error.code, error.message, error.details ? { details: error.details } : {}));
    return;
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    log.warn('Unhandled validation error', { ...requestContext, details });
    res
      .status(400)
      .json(failure('VALIDATION_ERROR', 'پارامترهای ورودی نامعتبر است.', { details }));
    return;
  }

  const reason = error instanceof Error ? error.message : String(error);
  log.error('Unhandled error', { ...requestContext, reason });
  res
    .status(500)
    .json(failure('INTERNAL_ERROR', 'خطای داخلی سرور رخ داد. جزئیات در لاگ سرور ثبت شد.'));
}
