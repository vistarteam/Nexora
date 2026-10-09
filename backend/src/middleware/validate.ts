import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Validate one part of the request against a schema and replace it with the
 * parsed (coerced, defaulted) value, so controllers always receive clean input.
 *
 * `req.query` and `req.params` are read-only in Express 5 typings, so results
 * are stored on `res.locals.validated` as well as assigned defensively.
 */
export function validate<T>(schema: ZodType<T>, part: RequestPart) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(toApiError(result.error, part));
      return;
    }

    if (part === 'body') {
      req.body = result.data as Request['body'];
    } else {
      // Query/params objects are mutated in place rather than replaced, which
      // works on both Express 4 and 5.
      Object.assign(req[part] as object, result.data as object);
    }

    res.locals.validated = result.data;
    next();
  };
}

function toApiError(error: ZodError, part: RequestPart): ApiError {
  const details = error.issues.map((issue) => ({
    path: [part, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));

  // A ZodError is a 400 by definition; never let it surface as a 500.
  return ApiError.validation('پارامترهای ورودی نامعتبر است.', details);
}

/** Convenience accessor for handlers that want the parsed value explicitly. */
export function validated<T>(res: Response): T {
  return res.locals.validated as T;
}
