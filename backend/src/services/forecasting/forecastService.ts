/** Forecast generation. Statistical intervals are explicitly approximations until
 * out-of-sample calibration is run; they must not be marketed as calibrated. */
import { randomUUID } from 'node:crypto';
import type { Candle, Timeframe } from '../../types/domain.js';
import type { BaselineForecast, BaselineModelType, ForecastConfidence, ForecastHorizon, ForecastResult, HorizonForecast, MarketRegime } from '../../types/forecasting.js';
import { createLogger } from '../../lib/logger.js';
import { extractFeatures, logReturns, std } from './featureEngineering.js';
import { generateBaselineForecast } from './baselineModels.js';
const log = createLogger('forecasting:service');
export const HORIZON_MS: Record<ForecastHorizon, number> = {'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
type CandleMeta = Candle & { isClosed?: boolean; ingestedAt?: number };
interface ForecastConfig { symbol:string; timeframe:Timeframe; candles:Candle[]; horizons?:ForecastHorizon[]; baselineModel?:BaselineModelType; version?:string; asOfTime?:number }
const TIMEFRAME_MS:Record<Timeframe,number>={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
export function generateForecast(config:ForecastConfig):ForecastResult {
 const {symbol,timeframe,horizons=['15m','1h','4h'],baselineModel='momentum',version='baseline-v0.2.0'}=config;
 const now=config.asOfTime ?? Date.now();
 const eligible=(config.candles as CandleMeta[]).filter(c=>c.time<=now && c.isClosed!==false && (c.ingestedAt===undefined||c.ingestedAt<=now)).sort((a,b)=>a.time-b.time);
 const reference=eligible.at(-1); const referencePrice=reference?.close??0; const referenceTime=reference?.time??0;
 const featureSet=extractFeatures({symbol,timeframe,candles:eligible,asOfTime:now});
 const marketRegime=classifyRegime(featureSet.features); const dataQuality=featureSet.dataQuality;
 const warnings:string[]=[];
 if(dataQuality==='insufficient') warnings.push(`Insufficient data (${featureSet.candleCount} candles) for robust forecast`);
 if(dataQuality==='degraded') warnings.push('Data quality is degraded; treat forecast with caution');
 if(eligible.length!==config.candles.length) warnings.push('Excluded forming, future-dated, or not-yet-ingested candles.');
 warnings.push('Probabilities and intervals are Gaussian approximations from historical returns, not calibrated probabilities; require walk-forward validation.');
 const returns=logReturns(eligible.map(c=>c.close)); const sigmaPerBar=std(returns.slice(-Math.min(200,returns.length)))??0;
 const forecasts:HorizonForecast[]=horizons.map(duration=>{
  const baseline=generateBaselineForecast({model:baselineModel,symbol,timeframe,horizon:duration,candles:eligible});
  const bars=Math.max(1,HORIZON_MS[duration]/TIMEFRAME_MS[timeframe]); const point=baseline.predictedReturn*bars; const sigma=sigmaPerBar*Math.sqrt(bars);
  const threshold=0.001; const up=sigma>0?1-normalCdf((threshold-point)/sigma):(point>threshold?1:0); const down=sigma>0?normalCdf((-threshold-point)/sigma):(point< -threshold?1:0); const neutral=Math.max(0,Math.min(1,1-up-down));
  return {duration,expiresAt:new Date(now+HORIZON_MS[duration]).toISOString(),expiresInMs:HORIZON_MS[duration],returnForecast:{point,lower:sigma>0?point-1.6448536269514722*sigma:null,upper:sigma>0?point+1.6448536269514722*sigma:null,coverage:0.9},directionProb:{up,down,neutral,threshold},marketRegime,confidence:deriveConfidence(dataQuality,point,sigma)};
 });
 const result:ForecastResult={id:randomUUID(),symbol,timeframe,generatedAt:new Date(now).toISOString(),generatedAtMs:now,referencePrice,referenceTime,horizons:forecasts,model:{id:baselineModel,version,description:`Baseline ${baselineModel}; uncalibrated statistical forecast`},features:featureSet.features,dataQuality,warnings};
 log.info('Forecast generated',{symbol,timeframe,horizons:forecasts.length,regime:marketRegime,quality:dataQuality,referencePrice}); return result;
}
export function generateAllBaselineForecasts(params:{symbol:string;timeframe:Timeframe;horizon:ForecastHorizon;candles:Candle[]}):BaselineForecast[]{return (['zero','historical_mean','momentum','mean_reversion','last_return'] as BaselineModelType[]).map(model=>generateBaselineForecast({model,...params}));}
export function classifyRegime(f:Record<string,number|null>):MarketRegime {const v=f.return_std_ratio;if(v!=null&&v>1.5)return'high_volatility';const a=f.distance_sma_50,b=f.distance_sma_200;if(a==null)return'unknown';if(a>0.01&&(b==null||b>-0.01))return'uptrend';if(a< -0.01)return'downtrend';return'range';}
function deriveConfidence(q:'good'|'degraded'|'insufficient',point:number,sigma:number):ForecastConfidence {if(q==='insufficient'||sigma===0)return'low';if(q==='degraded')return'medium';if(Math.abs(point)>sigma*1.5)return'high';if(Math.abs(point)>sigma*.5)return'medium';return'low';}
function normalCdf(x:number):number {const z=Math.abs(x),t=1/(1+0.2316419*z),d=0.3989423*Math.exp(-z*z/2);const p=1-d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>=0?p:1-p;}
