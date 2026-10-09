import { config } from '../../config/env.js';
import type { Candle, CandleSeries, Timeframe } from '../../types/domain.js';
import { createLogger } from '../../lib/logger.js';
import {
  assertSupports,
  MarketDataError,
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
} from './types.js';

const log = createLogger('market-data:binance');

/**
 * Real market data from Binance's public REST API.
 *
 * Uses the unauthenticated `GET /api/v3/klines` endpoint, so no API key is
 * required. It only serves crypto pairs and is restricted to the `BINANCE:*`
 * namespace. Enable with `MARKET_DATA_PROVIDER=binance`.
 *
 * Note: availability depends on network access from the host running the
 * backend. Failures surface as an explicit `UPSTREAM_UNAVAILABLE` error — the
 * service never silently substitutes demo candles for a failed live request.
 */
const BINANCE_INTERVALS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id = 'binance';
  readonly label = 'Binance (عمومی)';
  readonly mode = 'live' as const;
  readonly supports = ['crypto'] as const;

  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string } = {}) {
    this.baseUrl = (options.baseUrl || config.marketData.baseUrl || 'https://api.binance.com')
      .replace(/\/+$/, '');
  }

  private toBinanceSymbol(symbol: string): string {
    const [prefix, rest] = symbol.includes(':') ? symbol.split(':', 2) : ['BINANCE', symbol];
    const ticker = (rest ?? '').toUpperCase();
    if (prefix && prefix.toUpperCase() !== 'BINANCE') {
      throw new MarketDataError(
        `symbol "${symbol}" is not served by the binance provider`,
        'invalid_symbol',
      );
    }
    if (!/^[A-Z0-9]{5,20}$/.test(ticker)) {
      throw new MarketDataError(`invalid binance symbol "${symbol}"`, 'invalid_symbol');
    }
    return ticker;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    assertSupports(this, request.assetClass, request.symbol);

    const ticker = this.toBinanceSymbol(request.symbol);
    const interval = BINANCE_INTERVALS[request.timeframe];
    const limit = Math.max(10, Math.min(request.limit, 1000, config.marketData.maxLimit));

    const url = new URL(`${this.baseUrl}/api/v3/klines`);
    url.searchParams.set('symbol', ticker);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.marketData.timeoutMs);

    let payload: unknown;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new MarketDataError(
          `binance responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
          'upstream',
        );
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      log.warn('Binance request failed', { symbol: ticker, interval, reason });
      throw new MarketDataError(`binance request failed: ${reason}`, 'upstream', error);
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(payload)) {
      throw new MarketDataError('binance returned an unexpected payload shape', 'upstream');
    }

    const decimals = ticker.endsWith('USDT') ? 2 : 8;
    const candles: Candle[] = (payload as BinanceKline[]).map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));

    const clean = sanitizeCandles(candles);
    if (clean.length === 0) {
      throw new MarketDataError(
        `binance returned no usable candles for ${ticker} (${interval})`,
        'upstream',
      );
    }

    return {
      symbol: request.symbol,
      tvSymbol: request.tvSymbol,
      assetClass: request.assetClass,
      timeframe: request.timeframe,
      candles: clean.map((candle) => ({
        ...candle,
        open: Number(candle.open.toFixed(decimals)),
        high: Number(candle.high.toFixed(decimals)),
        low: Number(candle.low.toFixed(decimals)),
        close: Number(candle.close.toFixed(decimals)),
      })),
      source: { provider: this.id, mode: 'live', fetchedAt: new Date().toISOString() },
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.marketData.timeoutMs, 4_000));
    try {
      const response = await fetch(`${this.baseUrl}/api/v3/ping`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      return response.ok
        ? { ok: true, detail: `${this.baseUrl} reachable` }
        : { ok: false, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Used when `MARKET_DATA_PROVIDER=none`; every request fails explicitly. */
export class NullMarketDataProvider implements MarketDataProvider {
  readonly id = 'none';
  readonly label = 'بدون منبع داده';
  readonly mode = 'demo' as const;
  readonly supports = [] as const;

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    throw new MarketDataError(
      `no market-data provider is configured (MARKET_DATA_PROVIDER=none); ${request.symbol} cannot be loaded`,
      'not_configured',
    );
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: 'MARKET_DATA_PROVIDER=none' };
  }
}
