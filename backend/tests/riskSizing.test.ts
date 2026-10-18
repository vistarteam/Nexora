import { describe, expect, it } from 'vitest';
import { sizePosition } from '../src/services/strategy/riskSizing.js';

describe('sizePosition', () => {
  it('declines when edge is too weak', () => {
    expect(sizePosition({ balance: 1000, riskPercent: 1, entry: 100, stopLoss: 95, takeProfit: 110, probabilityOfProfit: 0.51 }).decision).toBe('no_trade');
  });
  it('returns a bounded hypothetical position plan for sufficient edge', () => {
    const result = sizePosition({ balance: 1000, riskPercent: 1, entry: 100, stopLoss: 95, takeProfit: 112, probabilityOfProfit: 0.65, maxLeverage: 3 });
    expect(result.decision).toBe('trade_plan');
    if (result.decision === 'trade_plan') {
      expect(result.positionSize).toBeGreaterThan(0);
      expect(result.rewardRisk).toBeCloseTo(2.4);
      expect(result.suggestedLeverage).toBeLessThanOrEqual(3);
      expect(result.estimatedCosts).toBeGreaterThan(0);
    }
  });
});
