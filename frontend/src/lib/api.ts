import type {
  AnalysisReport,
  AnalysisSummary,
  ApiFieldIssue,
  ApiMeta,
  BootstrapPayload,
  CandleSeries,
  HealthPayload,
  MarketsPayload,
  WatchlistItem,
} from '../types/nexora';

/**
 * Typed API client.
 *
 * Responsibilities:
 *  - unwrap the `{ ok, data, meta }` envelope so callers never see it,
 *  - turn every failure mode (HTTP error, network failure, malformed body) into
 *    a single `ApiError` type the UI can render,
 *  - surface the `meta` block, which is how the UI learns that a response is
 *    demo data or that persistence is not durable.
 */

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const API_BASE = RAW_BASE.replace(/\/+$/, '');
const API_PREFIX = `${API_BASE}/api`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiFieldIssue[];
  readonly isNetworkError: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      details?: ApiFieldIssue[];
      isNetworkError?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'UNKNOWN';
    this.details = options.details ?? [];
    this.isNetworkError = options.isNetworkError ?? false;
  }

  /** True when retrying could plausibly help. */
  get isRetryable(): boolean {
    return this.isNetworkError || this.status >= 500;
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, params, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('ارتباط با سرور برقرار نشد. اتصال شبکه یا اجرای سرور را بررسی کنید.', {
      code: 'NETWORK_ERROR',
      isNetworkError: true,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? 'پاسخ سرور قابل خواندن نبود.'
        : `سرور پاسخ نامعتبر برگرداند (کد ${response.status}).`,
      { status: response.status, code: 'MALFORMED_RESPONSE' },
    );
  }

  if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
    throw new ApiError('ساختار پاسخ سرور با قرارداد API مطابقت ندارد.', {
      status: response.status,
      code: 'MALFORMED_RESPONSE',
    });
  }

  const envelope = payload as
    | { ok: true; data: T; meta: ApiMeta }
    | { ok: false; error: { code: string; message: string; details?: ApiFieldIssue[] }; meta: ApiMeta };

  if (!envelope.ok) {
    throw new ApiError(
      envelope.error?.message || 'درخواست با خطا مواجه شد.',
      {
        status: response.status,
        code: envelope.error?.code ?? 'UNKNOWN',
        details: envelope.error?.details ?? [],
      },
    );
  }

  return { data: envelope.data, meta: envelope.meta ?? { generatedAt: '', demo: false } };
}

/* ------------------------------------------------------------------ *
 * Endpoint functions
 * ------------------------------------------------------------------ */

export const api = {
  health: (signal?: AbortSignal) => request<HealthPayload>('/health', { signal }),

  bootstrap: (signal?: AbortSignal) => request<BootstrapPayload>('/config', { signal }),

  markets: (
    params: { assetClass?: string; q?: string } = {},
    signal?: AbortSignal,
  ) => request<MarketsPayload>('/markets', { params, signal }),

  candles: (
    params: { symbol: string; assetClass: string; timeframe: string; limit?: number },
    signal?: AbortSignal,
  ) => request<CandleSeries>('/market-data', { params, signal }),

  runAnalysis: (
    body: { symbol: string; assetClass: string; timeframe: string; limit?: number; save?: boolean },
    signal?: AbortSignal,
  ) =>
    request<{ report: AnalysisReport; saved: boolean; durationMs: number }>('/analysis', {
      method: 'POST',
      body,
      signal,
    }),

  watchlist: (signal?: AbortSignal) =>
    request<{ items: WatchlistItem[]; count: number }>('/watchlist', { signal }),

  addToWatchlist: (body: { symbol: string; assetClass: string }, signal?: AbortSignal) =>
    request<{ item: WatchlistItem; created: boolean }>('/watchlist', {
      method: 'POST',
      body,
      signal,
    }),

  removeFromWatchlist: (symbol: string, signal?: AbortSignal) =>
    request<{ symbol: string; removed: boolean }>(`/watchlist/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
      signal,
    }),

  history: (params: { limit?: number } = {}, signal?: AbortSignal) =>
    request<{ items: AnalysisSummary[]; count: number; total: number }>('/history', {
      params,
      signal,
    }),

  report: (id: string, signal?: AbortSignal) =>
    request<{ report: AnalysisReport }>(`/history/${encodeURIComponent(id)}`, { signal }),

  deleteReport: (id: string, signal?: AbortSignal) =>
    request<{ id: string; removed: boolean }>(`/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
};

export { API_PREFIX };
