import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/types/domain.js';
import { analyzeCandles } from '../src/services/analysis/reference/index.js';
import {
  probePythonEngine,
  runPythonEngine,
} from '../src/services/analysis/pythonEngine.js';
import { DEFAULT_ENGINE_OPTIONS, type EngineSeries } from '../src/services/analysis/types.js';

/**
 * Cross-engine parity.
 *
 * The platform may answer with either the Python engine or the TypeScript
 * reference, and the UI cannot tell which ran. If their indicator series drifted
 * apart, the same symbol would be charted differently depending on whether a
 * Python interpreter happened to be installed — the exact class of inconsistency
 * the chart payload exists to eliminate.
 *
 * The Python engine is spawned for real. When no interpreter is installed the
 * whole block is *skipped*, which is visible in the test output — it must never
 * pass quietly on a comparison that never happened.
 */

const pythonAvailable = (await probePythonEngine()).ok;

const T0 = 1_700_000_000_000;

/** The same deterministic zigzag used by the Python engine's own tests. */
function startCandles(count = 300, leg = 6, step = 0.01): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    const direction = Math.floor(index / leg) % 2 === 0 ? 1 : -1;
    const open = price;
    const close = open * (1 + direction * step);
    const wick = 1 + 0.0005 + (0.002 * ((index * 37) % 11)) / 11;
    candles.push({
      time: T0 + index * 3_600_000,
      open: Number(open.toFixed(6)),
      high: Number((Math.max(open, close) * wick).toFixed(6)),
      low: Number((Math.min(open, close) * (2 - wick)).toFixed(6)),
      close: Number(close.toFixed(6)),
      volume: 1000 + index,
    });
    price = close;
  }
  return candles;
}

/** Every numeric array in the series block, identified for assertion messages. */
function flatten(series: EngineSeries): Record<string, Array<number | null>> {
  const flat: Record<string, Array<number | null>> = {
    rsi: series.rsi,
    atr: series.atr,
    'macd.macd': series.macd.macd,
    'macd.signal': series.macd.signal,
    'macd.histogram': series.macd.histogram,
  };
  for (const [period, values] of Object.entries(series.sma)) flat[`sma${period}`] = values;
  for (const [period, values] of Object.entries(series.ema)) flat[`ema${period}`] = values;
  return flat;
}

describe.skipIf(!pythonAvailable)('engine parity', () => {
  it('emits an identical chart series from both engines', async () => {
    const candles = startCandles(300);
    const options = { ...DEFAULT_ENGINE_OPTIONS, includeSeries: true };

    const typescript = analyzeCandles(candles, options, { symbol: 'X', timeframe: '1h' });
    expect(typescript.status).toBe('ok');
    expect(typescript.series).not.toBeNull();

    // The probe above already proved the interpreter responds, so a failure here
    // is a real regression, not a missing runtime: let it surface.
    const python = await runPythonEngine({
      symbol: 'X',
      timeframe: '1h',
      candles,
      options,
    });

    expect(python.status).toBe('ok');
    expect(python.series).not.toBeNull();
    const pySeries = python.series as EngineSeries;
    const tsSeries = typescript.series as EngineSeries;

    expect(pySeries.count).toBe(tsSeries.count);

    const tsFlat = flatten(tsSeries);
    const pyFlat = flatten(pySeries);
    expect(Object.keys(pyFlat).sort()).toEqual(Object.keys(tsFlat).sort());

    for (const [name, tsValues] of Object.entries(tsFlat)) {
      const pyValues = pyFlat[name] as Array<number | null>;
      expect(pyValues.length, `${name} length`).toBe(tsValues.length);

      // Warm-up regions must be null in exactly the same places, otherwise the
      // two engines would start the same curve at different bars.
      const tsNulls = tsValues.map((value) => value === null);
      const pyNulls = pyValues.map((value) => value === null);
      expect(pyNulls, `${name} warm-up`).toEqual(tsNulls);

      let maxDiff = 0;
      for (let index = 0; index < tsValues.length; index += 1) {
        const tsValue = tsValues[index] ?? null;
        const pyValue = pyValues[index] ?? null;
        if (tsValue === null || pyValue === null) continue;
        maxDiff = Math.max(maxDiff, Math.abs(tsValue - pyValue));
      }
      expect(maxDiff, `${name} max difference`).toBeLessThan(1e-6);
    }

    // Structural outputs must match element for element.
    expect(pySeries.swings).toEqual(tsSeries.swings);
    expect(pySeries.regression).toEqual(tsSeries.regression);

    // And the reported facts, which are the human-facing numbers, must agree too.
    expect(python.facts?.indicators.rsi?.value).toBeCloseTo(
      typescript.facts?.indicators.rsi?.value as number,
      6,
    );
    expect(python.facts?.trend?.direction).toBe(typescript.facts?.trend?.direction);

    // The trend evidence is prose the UI renders verbatim; the volatility line
    // must read identically (same window label, same figures) from either
    // engine, or the two-volatility note in the contract breaks.
    const pyVolLine = python.facts?.trend?.evidence.find((line) => line.includes('نوسان بازده‌ها'));
    const tsVolLine = typescript.facts?.trend?.evidence.find((line) => line.includes('نوسان بازده‌ها'));
    expect(pyVolLine).toBe(tsVolLine);
    expect(tsVolLine).toContain('آخرین 90 کندل روند');

    const pyVolatilityReading = python.interpretation?.volatilityReading;
    const tsVolatilityReading = typescript.interpretation?.volatilityReading;
    expect(pyVolatilityReading).toBe(tsVolatilityReading);
    expect(tsVolatilityReading).toContain('انحراف معیار ساده روی کل 300 کندل');
  });
});
