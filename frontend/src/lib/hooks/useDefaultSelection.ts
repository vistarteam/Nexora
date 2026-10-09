import { useMemo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useSystem } from '../../context/SystemContext';
import type { AssetClass, Timeframe } from '../../types/nexora';

export interface DefaultSelection {
  symbol: string | null;
  assetClass: AssetClass;
  timeframe: Timeframe;
}

/**
 * The selection to use when the URL carries none.
 *
 * Precedence: user settings → backend configuration → built-in fallback. This is
 * the only place that decides, so every page opens on the same instrument.
 */
export function useDefaultSelection(): DefaultSelection {
  const { settings } = useSettings();
  const { bootstrap } = useSystem();

  return useMemo(
    () => ({
      assetClass: settings.defaultAssetClass,
      timeframe: settings.defaultTimeframe,
      symbol: settings.defaultSymbol ?? bootstrap?.defaults.symbol ?? 'BINANCE:BTCUSDT',
    }),
    [
      bootstrap?.defaults.symbol,
      settings.defaultAssetClass,
      settings.defaultSymbol,
      settings.defaultTimeframe,
    ],
  );
}
