import { describe, expect, it } from 'vitest';
import { backtestStrategy } from '../src/services/strategy/backtesting.js';
import type { Candle } from '../src/types/domain.js';
const candles:Candle[]=[0,1,2,3,4].map(i=>({time:i*60000,open:100+i,high:103+i,low:99+i,close:101+i,volume:100}));
describe('strategy backtesting',()=>{
 it('charges round-trip costs and computes trade metrics',()=>{
  const r=backtestStrategy(candles,[{time:candles[0]!.time,side:'long',probability:.8,expectedReturn:.01,uncertainty:.005}],{commission:.001,spread:.0005,slippage:.0005});
  expect(r.trades).toHaveLength(1); expect(r.costs.roundTrip).toBeCloseTo(.004); expect(r.trades[0]!.netReturn).toBeLessThan(r.trades[0]!.grossReturn); expect(r.finalEquity).toBeGreaterThan(0);
 });
 it('abstains when probability is weak or uncertainty is high',()=>{
  const r=backtestStrategy(candles,[{time:0,side:'long',probability:.51,expectedReturn:.01,uncertainty:.001},{time:60000,side:'short',probability:.8,expectedReturn:-.01,uncertainty:.2}]);
  expect(r.trades).toHaveLength(0); expect(r.abstentions).toBe(2);
 });
 it('returns null Sharpe with no variable trade returns',()=>{
  const r=backtestStrategy(candles,[]); expect(r.sharpe).toBeNull(); expect(r.profitFactor).toBe(0);
 });
});
