import type { DataMode } from './domain.js';

/** Metadata attached to every response, successful or not. */
export interface ApiMeta {
  /** ISO timestamp of when the response was produced. */
  generatedAt: string;
  /** True when any part of the payload is derived from synthetic demo data. */
  demo: boolean;
  /** Present when the endpoint depends on storage: false means not durable. */
  persistent?: boolean;
  /** Storage driver actually in use, e.g. `json` | `memory`. */
  storage?: string;
  /** Human readable, non-fatal notices safe to display in the UI. */
  notices?: string[];
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFieldIssue {
  path: string;
  message: string;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: ApiFieldIssue[];
  };
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Body of `GET /api/health`. */
export interface HealthPayload {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  environment: string;
  checks: {
    api: 'ok';
    analysisEngine: {
      status: 'available' | 'unavailable';
      executable: string;
      id: 'python' | 'typescript-fallback';
      detail?: string;
    };
    marketData: {
      provider: string;
      mode: DataMode;
      detail?: string;
    };
    storage: {
      driver: string;
      persistent: boolean;
      detail?: string;
    };
  };
}

/** Body of `GET /api/markets`. */
export interface MarketsPayload {
  items: MarketCatalogItem[];
  assetClasses: Array<{ id: string; label: string; count: number }>;
  total: number;
}

export interface MarketCatalogItem {
  symbol: string;
  tvSymbol: string;
  name: string;
  assetClass: string;
  venue: string;
}
