import fs from 'node:fs';
import path from 'node:path';
import { fetchYahooHourly } from '../src/lib/api/intraday';
import { type PriceDataset, type IntradayBar, validBar, priceDatasetIssues } from '../src/lib/market-evidence';
import { loadLocalEnvironment, daysArgument } from './lib/environment';

async function twelveData(instrument: string, ticker: string, days: number): Promise<PriceDataset> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error('Twelve Data key unavailable');
  const url = new URL('https://api.twelvedata.com/time_series');
  const now = new Date();
  for (const [k, v] of Object.entries({symbol:ticker, interval:'1h', timezone:'UTC', outputsize:'5000',
    start_date:new Date(now.getTime()-days*86_400_000).toISOString().slice(0,19).replace('T',' '),
    end_date:now.toISOString().slice(0,19).replace('T',' '), apikey:key})) url.searchParams.set(k,v);
  const response = await fetch(url, {signal:AbortSignal.timeout(20_000)});
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.values)) throw new Error(`Twelve Data unavailable (HTTP ${response.status}, code ${data.code ?? 'unknown'})`);
  const bars: IntradayBar[] = data.values.map((row: Record<string,string>) => {
    const openTime = new Date(row.datetime.replace(' ','T')+'Z').toISOString();
    return {openTime, closeTime:new Date(Date.parse(openTime)+3_600_000).toISOString(),
      open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close)};
  }).filter((bar: IntradayBar)=>validBar(bar)&&Date.parse(bar.closeTime)<=now.getTime())
    .sort((a:IntradayBar,b:IntradayBar)=>a.openTime.localeCompare(b.openTime));
  const dataset: PriceDataset = {schemaVersion:1,instrument,provider:'Twelve Data',intervalMinutes:60,fetchedAt:now.toISOString(),bars};
  if (priceDatasetIssues(dataset).length) throw new Error('Twelve Data failed executable-session quality checks');
  return dataset;
}

async function main() {
  loadLocalEnvironment();
  const days=daysArgument();
  if (days > 60) throw new Error('This hourly acquisition supports up to 60 days; longer history needs a licensed archive.');
  const dir=path.join('data','validation-v3','prices');
  fs.mkdirSync(dir,{recursive:true});
  const specs=[['XAUUSD','XAU/USD',null],['GBPUSD','GBP/USD','GBPUSD=X'],['US100','US100','^NDX'],['DJ30','DJI','^DJI'],['BTCUSD','BTC/USD','BTC-USD'],['DXY',null,'DX-Y.NYB'],['US10Y',null,'^TNX']] as const;
  const availability: Record<string,string>={};
  for(const [instrument,td,yahoo] of specs){
    let dataset: PriceDataset | null=null;
    if(td){try{dataset=await twelveData(instrument,td,days);}catch{ /* Fall back only to the same underlying instrument, never gold futures. */ }}
    if(!dataset&&yahoo){try{dataset=await fetchYahooHourly(instrument,yahoo,'60d');}catch{ /* Missing instruments stay missing. */ }}
    if(dataset?.bars.length && !priceDatasetIssues(dataset).length){
      fs.writeFileSync(path.join(dir,`${instrument}.json`),JSON.stringify(dataset,null,2)+'\n');
      availability[instrument]=`${dataset.bars.length} hourly bars from ${dataset.provider}`;
    }else {
      availability[instrument]='unavailable or failed data-quality checks';
      // Replace stale prior acquisitions with an explicit unavailable dataset.
      fs.writeFileSync(path.join(dir,`${instrument}.json`),JSON.stringify({schemaVersion:1,instrument,provider:'unavailable',intervalMinutes:60,fetchedAt:new Date().toISOString(),bars:[]},null,2)+'\n');
    }
    console.log(`${instrument}: ${availability[instrument]}`);
  }
  fs.writeFileSync(path.join(dir,'availability.json'),JSON.stringify({fetchedAt:new Date().toISOString(),availability},null,2)+'\n');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Price acquisition failed');process.exitCode=1;});
