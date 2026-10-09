import { createLogger } from './lib/logger.js';
import { AnalysisService } from './services/analysis/analysisService.js';
import { HistoryService } from './services/historyService.js';
import { MarketDataService, createMarketDataProvider } from './services/marketData/index.js';
import { WatchlistService } from './services/watchlistService.js';
import { createStorage, type Storage } from './storage/index.js';

const log = createLogger('container');

/**
 * Manually-wired dependency container.
 *
 * Explicit constructor injection (no decorators, no service locator) keeps the
 * dependency graph readable and every service trivially unit-testable: build
 * the pieces you want and pass them in.
 */
export interface Container {
  storage: Storage;
  marketData: MarketDataService;
  analysis: AnalysisService;
  history: HistoryService;
  watchlist: WatchlistService;
}

export async function createContainer(): Promise<Container> {
  const storage = await createStorage();
  const marketData = new MarketDataService(createMarketDataProvider());
  const history = new HistoryService(storage);
  const watchlist = new WatchlistService(storage);
  const analysis = new AnalysisService(marketData, history);

  log.info('Container ready', {
    marketDataProvider: marketData.providerInfo.id,
    marketDataMode: marketData.providerInfo.mode,
    storage: storage.description.driver,
    storagePersistent: storage.description.persistent,
  });

  return { storage, marketData, analysis, history, watchlist };
}
