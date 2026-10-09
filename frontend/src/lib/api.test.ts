import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(implementation);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('unwraps a successful envelope and returns data plus meta', async () => {
    mockFetch(async () =>
      jsonResponse({
        ok: true,
        data: { items: [], count: 0 },
        meta: { generatedAt: '2026-01-01T00:00:00.000Z', demo: true, persistent: false },
      }),
    );

    const result = await api.watchlist();
    expect(result.data.count).toBe(0);
    expect(result.meta.demo).toBe(true);
    expect(result.meta.persistent).toBe(false);
  });

  it('throws an ApiError carrying the server message, code and field issues', async () => {
    mockFetch(async () =>
      jsonResponse(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'پارامترهای ورودی نامعتبر است.',
            details: [{ path: 'query.symbol', message: 'نماد الزامی است.' }],
          },
          meta: { generatedAt: '2026-01-01T00:00:00.000Z', demo: false },
        },
        400,
      ),
    );

    await expect(api.markets()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ path: 'query.symbol', message: 'نماد الزامی است.' }],
    });
  });

  it('reports a network failure as a retryable ApiError', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await api.health().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNetworkError).toBe(true);
    expect((error as ApiError).isRetryable).toBe(true);
  });

  it('marks a 5xx response as retryable', async () => {
    mockFetch(async () =>
      jsonResponse(
        { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'سرویس در دسترس نیست.' }, meta: {} },
        502,
      ),
    );

    const error = (await api.health().catch((caught: unknown) => caught)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.isRetryable).toBe(true);
  });

  it('rejects a body that does not follow the envelope contract', async () => {
    mockFetch(async () => jsonResponse({ unexpected: true }));

    const error = (await api.health().catch((caught: unknown) => caught)) as ApiError;
    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects a non-JSON body', async () => {
    mockFetch(async () => new Response('<html>oops</html>', { status: 200 }));

    const error = (await api.health().catch((caught: unknown) => caught)) as ApiError;
    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('serialises query parameters and omits empty ones', async () => {
    const spy = mockFetch(async () =>
      jsonResponse({ ok: true, data: { candles: [], count: 0 }, meta: {} }),
    );

    await api.candles({ symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto', timeframe: '1h', limit: 50 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('symbol=BINANCE%3ABTCUSDT');
    expect(url).toContain('limit=50');
    expect(url).toContain('timeframe=1h');
  });

  it('sends a JSON body with the right method for POST', async () => {
    const spy = mockFetch(async () =>
      jsonResponse(
        {
          ok: true,
          data: { report: { id: 'r1' }, saved: true, durationMs: 12 },
          meta: { demo: true },
        },
        201,
      ),
    );

    await api.runAnalysis({ symbol: 'BINANCE:BTCUSDT', assetClass: 'crypto', timeframe: '1h' });

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      symbol: 'BINANCE:BTCUSDT',
      assetClass: 'crypto',
      timeframe: '1h',
    });
  });

  it('encodes symbols inside the path for delete requests', async () => {
    const spy = mockFetch(async () => jsonResponse({ ok: true, data: { removed: true }, meta: {} }));

    await api.removeFromWatchlist('BINANCE:BTCUSDT');

    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('BINANCE%3ABTCUSDT');
    expect(url).not.toContain('BINANCE:BTCUSDT');
  });
});
