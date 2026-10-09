import type { ApiFailure, ApiMeta, ApiSuccess } from '../types/api.js';

export interface EnvelopeOptions {
  demo?: boolean;
  persistent?: boolean;
  storage?: string;
  notices?: string[];
}

export function buildMeta(options: EnvelopeOptions = {}): ApiMeta {
  const meta: ApiMeta = {
    generatedAt: new Date().toISOString(),
    demo: options.demo ?? false,
  };
  if (options.persistent !== undefined) meta.persistent = options.persistent;
  if (options.storage !== undefined) meta.storage = options.storage;
  if (options.notices && options.notices.length > 0) meta.notices = options.notices;
  return meta;
}

export function success<T>(data: T, options: EnvelopeOptions = {}): ApiSuccess<T> {
  return { ok: true, data, meta: buildMeta(options) };
}

export function failure(
  code: string,
  message: string,
  options: EnvelopeOptions & { details?: Array<{ path: string; message: string }> } = {},
): ApiFailure {
  const error: ApiFailure['error'] = { code, message };
  if (options.details && options.details.length > 0) error.details = options.details;
  return { ok: false, error, meta: buildMeta(options) };
}
