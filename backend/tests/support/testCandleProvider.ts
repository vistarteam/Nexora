import type { Candle, CandleSeries, DataMode } from '../../src/types/domain.js';
import { TIMEFRAME_MS } from '../../src/services/marketData/catalog.js';
import {
  sanitizeCandles,
  type CandleRequest,
  type MarketDataProvider,
} from '../../src/services/marketData/types.js';

/**
 * Offline test double for the market-data layer.
 *
 * The application deliberately has no synthetic data mode: every candle the API
 * serves comes from a real upstream, or the request fails. The API tests still
 * need to exercise routers, validation, services and the engine bridge without
 * touching the network or the filesystem, so this fixture lives in the test tree
 * — never in `src/` — and is imported only by tests.
 *
 * The series is a deterministic function of the request (no clock, no random
 * numbers), which keeps assertions stable.
 */
export class TestCandleProvider implements MarketDataProvider {
  readonly id = 'test';
  readonly label = 'test double';
  readonly mode: DataMode = 'live';
  readonly supports = ['crypto', 'forex', 'stocks'] as const;
  readonly candles: Candle[] = [];

  constructor(private readonly now: number = 1_700_000_000_000) {}

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    const intervalMs = TIMEFRAME_MS[request.timeframe];
    const count = Math.max(5, Math.min(request.limit, 1_000));
    const firstOpenTime = this.now - (count - 1) * intervalMs;

    const closeAt = (index: number): number => 100 + Math.sin(index / 12) * 5 + index * 0.05;

    const candles: Candle[] = Array.from({ length: count }, (_, index) => {
      const open = index === 0 ? closeAt(0) : closeAt(index - 1);
      const close = closeAt(index);
      return {
        time: firstOpenTime + index * intervalMs,
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 1_000 + index,
      };
    });

    this.candles.splice(0, this.candles.length, ...candles);

    return {
      symbol: request.symbol,
      tvSymbol: request.tvSymbol,
      assetClass: request.assetClass,
      timeframe: request.timeframe,
      candles: sanitizeCandles(candles),
      source: { provider: this.id, mode: 'live', fetchedAt: new Date(this.now).toISOString() },
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'offline test double' };
  }
}
