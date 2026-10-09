import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ASSET_CLASSES, TIMEFRAMES, type AssetClass, type Timeframe } from '../../types/nexora';

export interface Selection {
  symbol: string | null;
  assetClass: AssetClass;
  timeframe: Timeframe;
}

/**
 * The symbol / asset-class / timeframe selection, stored in the URL query.
 *
 * Putting it in the URL rather than in component state means:
 *  - the view is shareable and survives a reload,
 *  - the Dashboard can deep-link into a specific analysis,
 *  - Market Analysis and AI Analysis always agree on what is selected.
 *
 * Invalid values are ignored and fall back to the defaults, so a hand-edited URL
 * cannot put the app into an impossible state.
 */
export function useSelection(fallback: Selection) {
  const [searchParams, setSearchParams] = useSearchParams();

  const selection = useMemo<Selection>(() => {
    const assetParam = searchParams.get('assetClass');
    const timeframeParam = searchParams.get('timeframe');
    const symbolParam = searchParams.get('symbol');

    const assetClass = ASSET_CLASSES.includes(assetParam as AssetClass)
      ? (assetParam as AssetClass)
      : fallback.assetClass;

    const timeframe = TIMEFRAMES.includes(timeframeParam as Timeframe)
      ? (timeframeParam as Timeframe)
      : fallback.timeframe;

    const symbol = symbolParam && symbolParam.trim() !== '' ? symbolParam.trim() : null;

    return { symbol, assetClass, timeframe };
  }, [fallback.assetClass, fallback.timeframe, searchParams]);

  const patch = useCallback(
    (changes: Partial<Selection>) => {
      const next = new URLSearchParams(searchParams);
      const apply = (key: string, value: string | null): void => {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      };

      if ('assetClass' in changes) apply('assetClass', changes.assetClass ?? null);
      if ('timeframe' in changes) apply('timeframe', changes.timeframe ?? null);
      if ('symbol' in changes) apply('symbol', changes.symbol ?? null);

      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return {
    selection,
    setSymbol: useCallback((symbol: string | null) => patch({ symbol }), [patch]),
    setAssetClass: useCallback(
      // A symbol belongs to exactly one asset class, so changing the class
      // clears the current selection rather than silently mismatching it.
      (assetClass: AssetClass) => patch({ assetClass, symbol: null }),
      [patch],
    ),
    setTimeframe: useCallback((timeframe: Timeframe) => patch({ timeframe }), [patch]),
    setSelection: patch,
  };
}
