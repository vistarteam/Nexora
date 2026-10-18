import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  formatDateTime,
  formatDuration,
  formatInteger,
  formatNumber,
  formatPercent,
  formatRelative,
  type NumeralStyle,
  type NumberOptions,
} from '../lib/format';
import { usePersistentState } from '../lib/hooks/usePersistentState';
import { STORAGE_KEYS, createStorage } from '../lib/storage';
import type { AssetClass, Timeframe } from '../types/nexora';

export type Theme = 'dark' | 'light';

export interface Settings {
  theme: Theme;
  /** Persian (۱۲۳) or Latin (123) digits throughout the UI. */
  numerals: NumeralStyle;
  /** Applied when navigating to Market Analysis with no explicit selection. */
  defaultAssetClass: AssetClass;
  defaultTimeframe: Timeframe;
  /** `null` means "use the backend default". */
  defaultSymbol: string | null;
  /** Run an analysis automatically when a symbol/timeframe is chosen. */
  autoRunAnalysis: boolean;
  /** Show the caveats and validation notes attached to every report. */
  showCaveats: boolean;
  /** Denser rows in tables (mobile-friendly). */
  compactTables: boolean;
  /** Account currency balance used only for hypothetical position sizing. */
  accountBalance: number;
  /** Maximum planned loss as a percent of account balance. */
  riskPercent: number;
  chartLayers: { supportResistance: boolean; touchpoints: boolean; forecasts: boolean; scenarios: boolean; indicators: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  numerals: 'fa',
  defaultAssetClass: 'crypto',
  defaultTimeframe: '1h',
  defaultSymbol: null,
  autoRunAnalysis: false,
  showCaveats: true,
  compactTables: false,
  accountBalance: 1000,
  riskPercent: 1,
  chartLayers: { supportResistance: true, touchpoints: true, forecasts: true, scenarios: true, indicators: true },
};

interface SettingsContextValue {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
  /** True when writes actually survive a reload. */
  storagePersistent: boolean;
  storageDriver: string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  // Stored as one object so a schema change is a single version bump.
  const [settings, setSettings] = usePersistentState<Settings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  const storage = useMemo(() => createStorage(), []);

  // Merge in any keys added since the user's stored copy was written, so a new
  // setting never arrives as `undefined`.
  const merged = useMemo<Settings>(() => ({ ...DEFAULT_SETTINGS, ...settings }), [settings]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', merged.theme);
  }, [merged.theme]);

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((previous) => ({ ...previous, [key]: value }));
    },
    [setSettings],
  );

  const reset = useCallback(() => {
    storage.remove(STORAGE_KEYS.settings);
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings, storage]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings: merged,
      update,
      reset,
      storagePersistent: storage.persistent,
      storageDriver: storage.driver,
    }),
    [merged, reset, storage.driver, storage.persistent, update],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}

/**
 * Formatters bound to the user's numeral preference.
 * Components call `useFormat()` and never think about digits again.
 */
export function useFormat() {
  const { settings } = useSettings();
  const style = settings.numerals;

  return useMemo(
    () => ({
      style,
      number: (value: number | null | undefined, options: NumberOptions = {}) =>
        formatNumber(value, { style, ...options }),
      percent: (value: number | null | undefined, options: NumberOptions = {}) =>
        formatPercent(value, { style, ...options }),
      integer: (value: number | null | undefined) => formatInteger(value, style),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso),
      relative: (iso: string | null | undefined) => formatRelative(iso, style),
      duration: (ms: number) => formatDuration(ms, style),
    }),
    [style],
  );
}
