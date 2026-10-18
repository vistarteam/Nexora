/** Point-in-time feature engineering. Features are computed only from candles
 * whose open time and optional ingestion timestamp are <= asOfTime. A provider
 * may explicitly mark a candle isClosed=false; such candles are always excluded.
 */
import type { Candle, Timeframe } from '../../types/domain.js';
import type { FeatureSet, DataQuality } from '../../types/forecasting.js';

const FEATURE_VERSION = 'v1.1.0';
type CandleWithMetadata = Candle & { ingestedAt?: number; isClosed?: boolean };

export function extractFeatures(params: { symbol: string; timeframe: Timeframe; candles: Candle[]; asOfTime: number }): FeatureSet {
  const { symbol, timeframe, asOfTime } = params;
  const valid = (params.candles as CandleWithMetadata[])
    .filter(c => Number.isFinite(c.time) && c.time <= asOfTime && (c.ingestedAt === undefined || c.ingestedAt <= asOfTime) && c.isClosed !== false)
    .filter(c => [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) && c.close > 0 && c.low > 0 && c.high >= c.low)
    .sort((a,b) => a.time - b.time);
  const base = { asOfTime, symbol, timeframe, candleCount: valid.length, featureVersion: FEATURE_VERSION };
  if (valid.length < 50) return { ...base, features: {}, dataQuality: 'insufficient' };

  const closes = valid.map(c=>c.close), highs=valid.map(c=>c.high), lows=valid.map(c=>c.low), volumes=valid.map(c=>c.volume);
  const returns = logReturns(closes), f: Record<string, number|null> = {};
  f.return_1 = last(returns);
  f.return_5 = mean(returns.slice(-5)); f.return_20 = mean(returns.slice(-20));
  f.return_std_20 = std(returns.slice(-20));
  const rv20=std(returns.slice(-20)), rv60=std(returns.slice(-60));
  f.return_std_ratio = rv20 !== null && rv60 !== null && rv60 > 0 ? rv20/rv60 : null;
  for (const p of [20,50,200]) { const sma=closes.length>=p?mean(closes.slice(-p)):null; f[`sma_${p}`]=sma; f[`distance_sma_${p}`]=sma!==null?(closes.at(-1)!-sma)/sma:null; }
  for (const p of [9,12,21,26,55]) f[`ema_${p}`]=ema(closes,p);
  f.rsi_14=rsi(closes,14);
  const macdSeries = closes.map((_,i)=>{ const a=ema(closes.slice(0,i+1),12), b=ema(closes.slice(0,i+1),26); return a!==null&&b!==null?a-b:null; });
  const validMacd=macdSeries.filter((x):x is number=>x!==null);
  const macd=last(validMacd), signal=ema(validMacd,9);
  f.macd=macd; f.macd_signal=signal; f.macd_hist=macd!==null&&signal!==null?macd-signal:null;
  f.atr_14=atr(highs,lows,closes,14); f.atr_ratio=f.atr_14!==null?f.atr_14/closes.at(-1)!:null;
  const hh=highs.slice(-5), ph=highs.slice(-10,-5), hl=lows.slice(-5), pl=lows.slice(-10,-5);
  f.higher_highs=hh.length===5&&ph.length===5&&Math.max(...hh)>Math.max(...ph)?1:0;
  f.higher_lows=hl.length===5&&pl.length===5&&Math.min(...hl)>Math.min(...pl)?1:0;
  const hi=Math.max(...highs.slice(-20)), lo=Math.min(...lows.slice(-20)), close=closes.at(-1)!;
  f.distance_to_high=(close-hi)/hi; f.distance_to_low=(close-lo)/lo;
  const av=mean(volumes.slice(-20)); f.volume_ratio=av!==null&&av>0?volumes.at(-1)!/av:null;
  const nullCount=Object.values(f).filter(v=>v===null).length;
  const dataQuality: DataQuality=valid.length<200||nullCount>Object.keys(f).length*0.3?'degraded':'good';
  return { ...base, features:f, dataQuality };
}

export function logReturns(closes:number[]):number[] { const out:number[]=[]; for(let i=1;i<closes.length;i++){const a=closes[i-1]!,b=closes[i]!;out.push(a>0&&b>0?Math.log(b/a):0);} return out; }
export function mean(xs:number[]):number|null { return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null; }
export function std(xs:number[]):number|null { if(xs.length<2)return null; const m=mean(xs)!; return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/xs.length); }
export function ema(xs:number[],period:number):number|null { if(xs.length<period)return null; let v=mean(xs.slice(0,period))!; const k=2/(period+1); for(let i=period;i<xs.length;i++)v=xs[i]!*k+v*(1-k); return v; }
export function rsi(xs:number[],period=14):number|null { if(xs.length<period+1)return null; let g=0,l=0; for(let i=1;i<=period;i++){const d=xs[i]!-xs[i-1]!;g+=Math.max(d,0);l+=Math.max(-d,0);} g/=period;l/=period; for(let i=period+1;i<xs.length;i++){const d=xs[i]!-xs[i-1]!;g=(g*(period-1)+Math.max(d,0))/period;l=(l*(period-1)+Math.max(-d,0))/period;} return l===0?100:100-100/(1+g/l); }
export function atr(highs:number[],lows:number[],closes:number[],period=14):number|null { if(closes.length<period+1)return null; const tr:number[]=[]; for(let i=1;i<closes.length;i++)tr.push(Math.max(highs[i]!-lows[i]!,Math.abs(highs[i]!-closes[i-1]!),Math.abs(lows[i]!-closes[i-1]!))); let v=mean(tr.slice(0,period)); if(v===null)return null; for(let i=period;i<tr.length;i++)v=(v*(period-1)+tr[i]!)/period; return v; }
function last(xs:number[]):number|null{return xs.length?xs[xs.length-1]!:null;}
