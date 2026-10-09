/** Error codes shared by the API error envelope and the frontend. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * An error that is safe to serialise to an API consumer. Anything that is not
 * an `ApiError` is reported as a generic `INTERNAL_ERROR` so internal details
 * never leak, while still being logged server-side.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: FieldIssue[];
  /** Extra context for logs only — never serialised into the response. */
  readonly logContext?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: { details?: FieldIssue[]; logContext?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    if (options.details) this.details = options.details;
    if (options.logContext) this.logContext = options.logContext;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  static badRequest(message: string, details?: FieldIssue[]): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details ? { details } : {});
  }

  static validation(message: string, details: FieldIssue[]): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, { details });
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }

  static upstream(message: string, logContext?: Record<string, unknown>): ApiError {
    return new ApiError(502, 'UPSTREAM_UNAVAILABLE', message, logContext ? { logContext } : {});
  }

  static notConfigured(message: string): ApiError {
    return new ApiError(503, 'NOT_CONFIGURED', message);
  }

  static internal(message: string, cause?: unknown): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message, cause !== undefined ? { cause } : {});
  }
}
