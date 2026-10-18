/** Deterministic account-aware sizing. This is a planning aid, not an order executor. */
export interface RiskSizingInput {
  balance: number;
  riskPercent: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  probabilityOfProfit: number;
  minimumEdge?: number;
  maxLeverage?: number;
  feeRate?: number;
  slippageRate?: number;
}
export type RiskSizingResult =
  | { decision: 'no_trade'; reason: string; riskAmount: number }
  | { decision: 'trade_plan'; riskAmount: number; positionSize: number; entry: number; stopLoss: number; takeProfit: number; rewardRisk: number; suggestedLeverage: number; estimatedCosts: number };
export function sizePosition(input: RiskSizingInput): RiskSizingResult {
  const { balance, riskPercent, entry, stopLoss, takeProfit, probabilityOfProfit } = input;
  const riskAmount = balance * riskPercent / 100;
  const minEdge = input.minimumEdge ?? 0.03;
  if (![balance, riskPercent, entry, stopLoss, takeProfit, probabilityOfProfit].every(Number.isFinite) || balance <= 0 || riskPercent <= 0 || riskPercent > 5 || entry <= 0 || stopLoss <= 0 || takeProfit <= 0) return { decision: 'no_trade', reason: 'پارامترهای ریسک نامعتبر هستند.', riskAmount: 0 };
  const stopDistance = Math.abs(entry - stopLoss);
  const rewardDistance = Math.abs(takeProfit - entry);
  if (stopDistance <= 0 || rewardDistance <= 0 || (stopLoss < entry) !== (takeProfit > entry)) return { decision: 'no_trade', reason: 'ساختار ورود، حد ضرر و حد سود معتبر نیست.', riskAmount };
  const rewardRisk = rewardDistance / stopDistance;
  if (probabilityOfProfit < 0.5 + minEdge || rewardRisk < 1.2) return { decision: 'no_trade', reason: 'مزیت آماری یا نسبت ریسک به بازده کافی نیست.', riskAmount };
  const feeRate = Math.max(0, input.feeRate ?? 0.0004);
  const slippageRate = Math.max(0, input.slippageRate ?? 0.0002);
  const costPerUnit = stopDistance + entry * (2 * feeRate + 2 * slippageRate);
  const positionSize = riskAmount / costPerUnit;
  const maxLeverage = Math.max(1, input.maxLeverage ?? 3);
  const notional = positionSize * entry;
  const suggestedLeverage = Math.min(maxLeverage, Math.max(1, notional / balance));
  return { decision: 'trade_plan', riskAmount, positionSize, entry, stopLoss, takeProfit, rewardRisk, suggestedLeverage, estimatedCosts: positionSize * entry * (2 * feeRate + 2 * slippageRate) };
}
