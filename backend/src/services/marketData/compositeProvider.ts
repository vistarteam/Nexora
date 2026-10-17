import type { AssetClass, CandleSeries, DataMode } from '../../types/domain.js';
import { createLogger } from '../../lib/logger.js';
import { MarketDataError, type CandleRequest, type MarketDataProvider } from './types.js';

const log = createLogger('market-data:composite');

export interface CompositeRoute {
  assetClass: AssetClass;
  provider: MarketDataProvider;
}

/**
 * Routes a candle request to the provider that serves its asset class.
 *
 * No single free source covers crypto, forex and equities, and the sources that
 * *are* reachable from Iranian networks differ from the ones that are not. This
 * provider keeps that decision in one place: `MARKET_DATA_PROVIDER=auto` wires
 * crypto to an Iranian exchange and forex/equities to a keyless global feed, while
 * every other part of the application still talks to one `MarketDataProvider`.
 *
 * The child provider is preserved in `CandleSeries.source.provider`, so reports
 * and the UI always name the venue that actually answered.
 */
export class CompositeMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: DataMode;
  readonly supports: readonly AssetClass[];

  constructor(
    private readonly routes: readonly CompositeRoute[],
    options: { id?: string; label?: string } = {},
  ) {
    this.id = options.id ?? 'auto';
    this.label = options.label ?? 'چندمنبعی';
    // Only classes with a live upstream are advertised as supported, so the UI
    // never offers an asset class the backend cannot actually serve.
    const live = routes
      .filter((route) => route.provider.mode === 'live')
      .map((route) => route.assetClass);
    this.supports = [...new Set(live)];
    this.mode = this.supports.length > 0 ? 'live' : 'none';
  }

  /** The provider ids behind each asset class, for diagnostics. */
  get routeSummary(): string {
    return this.routes
      .map((route) => `${route.assetClass}→${route.provider.id}`)
      .join(', ');
  }

  private pick(assetClass: AssetClass): MarketDataProvider {
    const route = this.routes.find((candidate) => candidate.assetClass === assetClass);
    if (!route) {
      throw new MarketDataError(
        `no configured data source serves asset class "${assetClass}"`,
        'unsupported',
      );
    }
    return route.provider;
  }

  async fetchCandles(request: CandleRequest): Promise<CandleSeries> {
    const provider = this.pick(request.assetClass);
    log.debug('routing candle request', {
      symbol: request.symbol,
      assetClass: request.assetClass,
      provider: provider.id,
    });
    return provider.fetchCandles(request);
  }

  /**
   * Reachable only when every route is reachable: a partly-down composite would
   * otherwise report a healthy provider while some asset classes are failing.
   */
  async health(): Promise<{ ok: boolean; detail?: string }> {
    const results = await Promise.all(
      this.routes.map(async (route) => {
        try {
          return { ...route, result: await route.provider.health() };
        } catch (error) {
          return { ...route, result: { ok: false, detail: (error as Error).message } };
        }
      }),
    );

    const detail = results
      .map(
        (entry) =>
          `${entry.assetClass}:${entry.provider.id}=${entry.result.ok ? 'ok' : (entry.result.detail ?? 'down')}`,
      )
      .join('; ');

    return { ok: results.every((entry) => entry.result.ok), detail };
  }
}
