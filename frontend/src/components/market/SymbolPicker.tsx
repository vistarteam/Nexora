import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useApi } from '../../lib/hooks/useApi';
import type { AssetClass, MarketSymbol } from '../../types/nexora';
import { Skeleton } from '../ui/Feedback';
import { SearchIcon } from '../ui/Icons';

export interface SymbolPickerProps {
  /** Currently selected canonical symbol, or `null`. */
  value: string | null;
  assetClass: AssetClass;
  onSelect: (market: MarketSymbol) => void;
  label?: string;
}

/**
 * Searchable instrument picker.
 *
 * The catalog is small and static, so it is fetched once per asset class and
 * filtered on the client. That keeps typing instant and avoids a request per
 * keystroke. Keyboard interaction follows the combobox pattern.
 */
export function SymbolPicker({ value, assetClass, onSelect, label = 'نماد' }: SymbolPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const { data, loading, error } = useApi(
    (signal) => api.markets({ assetClass }, signal).then((result) => result.data),
    [assetClass],
  );

  const markets = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return markets;
    return markets.filter((market) =>
      [market.symbol, market.tvSymbol, market.name, market.venue]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [markets, query]);

  const selected = useMemo(
    () => markets.find((market) => market.symbol === value) ?? null,
    [markets, value],
  );

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, assetClass]);

  // Close on outside click so the dropdown never traps the pointer.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const commit = (market: MarketSymbol): void => {
    onSelect(market);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      const market = filtered[activeIndex];
      if (market) {
        event.preventDefault();
        commit(market);
      }
      return;
    }
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <label htmlFor={`${listboxId}-input`} className="nx-label">
        {label}
      </label>

      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 start-0 grid w-9 place-items-center text-ink-subtle">
          <SearchIcon width={15} height={15} />
        </span>
        <input
          id={`${listboxId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          className="nx-input ps-9"
          placeholder={selected ? `${selected.name} (${selected.symbol})` : 'جست‌وجوی نماد…'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {selected ? (
        <p className="mt-1.5 truncate text-2xs text-ink-subtle">
          انتخاب فعلی: <span className="text-ink-muted">{selected.name}</span>{' '}
          <span className="ltr-data text-ink-subtle">{selected.symbol}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-2xs text-ink-subtle">نمادی انتخاب نشده است.</p>
      )}

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="نتایج جست‌وجوی نماد"
          className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-border-strong bg-base-850 p-1 shadow-pop"
        >
          {loading ? (
            <div className="p-3">
              <Skeleton lines={3} />
            </div>
          ) : error ? (
            <p className="p-3 text-2xs text-bear">
              دریافت فهرست نمادها ناموفق بود. {error.message}
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-3 text-2xs text-ink-muted">
              نمادی با این عبارت یافت نشد. عبارت دیگری را امتحان کنید.
            </p>
          ) : (
            <ul>
              {filtered.map((market, index) => (
                <li key={market.symbol}>
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={market.symbol === value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(market)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-start transition',
                      index === activeIndex ? 'bg-base-800' : 'hover:bg-base-800/70',
                      market.symbol === value && 'text-accent',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-ink">{market.name}</span>
                      <span className="ltr-data block truncate text-2xs text-ink-subtle">
                        {market.symbol}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs text-ink-subtle">{market.venue}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
