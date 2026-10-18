import type { Candle } from '../../types/domain.js';
export type TradeSide='long'|'short';
export interface StrategySignal { time:number; side:TradeSide|'flat'; probability:number; expectedReturn:number; uncertainty?:number; stopLossPct?:number; takeProfitPct?:number; }
export interface StrategyConfig { initialCapital?:number; riskPerTrade?:number; maxPositionFraction?:number; minProbability?:number; maxUncertainty?:number; commission?:number; spread?:number; slippage?:number; annualizationPeriods?:number; }
export interface ExecutedTrade { entryTime:number; exitTime:number; side:TradeSide; entryPrice:number; exitPrice:number; positionFraction:number; grossReturn:number; netReturn:number; pnlFractionOfEquity:number; costsFraction:number; reason:string; }
export interface StrategyBacktestResult { trades:ExecutedTrade[]; finalEquity:number; totalReturn:number; maxDrawdown:number; sharpe:number|null; profitFactor:number|null; winRate:number; abstentions:number; costs:{commission:number;spread:number;slippage:number;roundTrip:number}; }
const defaults={initialCapital:1,riskPerTrade:.01,maxPositionFraction:.25,minProbability:.58,maxUncertainty:.02,commission:.001,spread:.0005,slippage:.0005,annualizationPeriods:252};
/** Costs are fractions of notional: commission and slippage charged per side,
 * spread and slippage are charged per side. Defaults imply 0.4% round-trip. */
export function backtestStrategy(candles:Candle[], signals:StrategySignal[], config:StrategyConfig={}):StrategyBacktestResult {
 const c={...defaults,...config}; const byTime=new Map(candles.map((x,i)=>[x.time,{candle:x,index:i}]));
 const trades:ExecutedTrade[]=[]; let equity=c.initialCapital, peak=equity, maxDrawdown=0, abstentions=0;
 for(const s of [...signals].sort((a,b)=>a.time-b.time)){
  const match=byTime.get(s.time); if(!match||s.side==='flat'||s.probability<c.minProbability||(s.uncertainty ?? 0)>c.maxUncertainty){abstentions++;continue;}
  const entry= candles[match.index+1]; if(!entry||entry.close<=0||entry.open<=0) {abstentions++;continue;}
  const side=s.side; const entryPrice=entry.open; let exit=entry; let exitPrice=entry.close; let reason='horizon exit';
  for(let i=match.index+1;i<candles.length;i++){const bar=candles[i]!;const stop=s.stopLossPct?entryPrice*(side==='long'?1-s.stopLossPct:1+s.stopLossPct):null;const take=s.takeProfitPct?entryPrice*(side==='long'?1+s.takeProfitPct:1-s.takeProfitPct):null;
   // Conservative: if stop and target both touch in one candle, stop wins.
   if(stop!==null&&((side==='long'&&bar.low<=stop)||(side==='short'&&bar.high>=stop))){exit=bar;exitPrice=stop;reason='stop loss';break;}
   if(take!==null&&((side==='long'&&bar.high>=take)||(side==='short'&&bar.low<=take))){exit=bar;exitPrice=take;reason='take profit';break;}
   if(i===candles.length-1){exit=bar;exitPrice=bar.close;}
  }
  const gross=side==='long'?exitPrice/entryPrice-1:entryPrice/exitPrice-1;
  const roundTrip=2*(c.commission+c.spread+c.slippage); const net=gross-roundTrip;
  const stopRisk=s.stopLossPct&&s.stopLossPct>0?Math.min(c.maxPositionFraction,c.riskPerTrade/s.stopLossPct):c.maxPositionFraction;
  const fraction=Math.max(0,Math.min(c.maxPositionFraction,stopRisk)); const pnl=equity*fraction*net; equity+=pnl;
  trades.push({entryTime:entry.time,exitTime:exit.time,side,entryPrice,exitPrice,positionFraction:fraction,grossReturn:gross,netReturn:net,pnlFractionOfEquity:pnl,costsFraction:roundTrip,reason});
  peak=Math.max(peak,equity); maxDrawdown=Math.max(maxDrawdown,peak>0?(peak-equity)/peak:0);
 }
 const returns=trades.map(t=>t.pnlFractionOfEquity); const avg=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:0;const variance=returns.length>1?returns.reduce((a,b)=>a+(b-avg)**2,0)/(returns.length-1):0;
 const wins=trades.filter(t=>t.pnlFractionOfEquity>0),losses=trades.filter(t=>t.pnlFractionOfEquity<0);const grossWin=wins.reduce((a,t)=>a+t.pnlFractionOfEquity,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.pnlFractionOfEquity,0));
 return {trades,finalEquity:equity,totalReturn:c.initialCapital!==0?equity/c.initialCapital-1:0,maxDrawdown,sharpe:variance>0?avg/Math.sqrt(variance)*Math.sqrt(c.annualizationPeriods):null,profitFactor:grossLoss>0?grossWin/grossLoss:(grossWin>0?null:0),winRate:trades.length?wins.length/trades.length:0,abstentions,costs:{commission:c.commission,spread:c.spread,slippage:c.slippage,roundTrip:roundTripCost(c)}};
}
function roundTripCost(c:typeof defaults):number{return 2*(c.commission+c.spread+c.slippage);}
