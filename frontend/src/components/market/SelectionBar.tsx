import { ASSET_CLASSES, TIMEFRAMES, type AssetClass, type MarketSymbol, type Timeframe } from '../../types/nexora';
import { ASSET_CLASS_LABELS, TIMEFRAME_LABELS } from '../../lib/format';
import { SegmentedControl } from '../ui/Field';
import { SymbolPicker } from './SymbolPicker';
import { Card } from '../ui/Card';

export interface SelectionBarProps {
  assetClass: AssetClass;
  timeframe: Timeframe;
  symbol: string | null;
  onAssetClassChange: (assetClass: AssetClass) => void;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onSymbolChange: (market: MarketSymbol) => void;
  /** Rendered at the end of the toolbar (e.g. the run-analysis button). */
  actions?: React.ReactNode;
  disabled?: boolean;
  /** Extra hint under the controls. */
  hint?: string;
}

/**
 * The symbol / asset-class / timeframe toolbar shared by Market Analysis and
 * AI Analysis, so both screens feel like one product.
 */
export function SelectionBar({
  assetClass,
  timeframe,
  symbol,
  onAssetClassChange,
  onTimeframeChange,
  onSymbolChange,
  actions,
  disabled = false,
  hint,
}: SelectionBarProps): JSX.Element {
  return (
    // `relative z-10` lifts this toolbar above the sibling cards that follow it.
    // Without it the symbol dropdown (absolutely positioned) is painted *under*
    // the price-chart card: `.nx-card` uses backdrop-blur, which creates a
    // stacking context, so a child z-index can never escape it.
    <Card className="relative z-10 nx-card-body">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_auto] lg:items-end">
        <div className="grid gap-4 sm:grid-cols-2">
          <SymbolPicker
            value={symbol}
            assetClass={assetClass}
            onSelect={onSymbolChange}
            label="نماد بازار"
          />

          <div>
            <span className="nx-label">کلاس دارایی</span>
            <SegmentedControl<AssetClass>
              ariaLabel="انتخاب کلاس دارایی"
              value={assetClass}
              onChange={onAssetClassChange}
              options={ASSET_CLASSES.map((item) => ({
                value: item,
                label: ASSET_CLASS_LABELS[item],
              }))}
            />
          </div>

          <div className="sm:col-span-2">
            <span className="nx-label">تایم‌فریم</span>
            <SegmentedControl<Timeframe>
              ariaLabel="انتخاب تایم‌فریم"
              value={timeframe}
              onChange={onTimeframeChange}
              options={TIMEFRAMES.map((item) => ({
                value: item,
                label: TIMEFRAME_LABELS[item],
              }))}
            />
          </div>
        </div>

        {actions ? <div className="flex flex-wrap items-end gap-2">{actions}</div> : null}
      </div>

      {hint ? <p className="mt-3 text-2xs leading-6 text-ink-subtle">{hint}</p> : null}
      {disabled ? (
        <p className="mt-3 text-2xs text-warn">برای ادامه، یک نماد انتخاب کنید.</p>
      ) : null}
    </Card>
  );
}
