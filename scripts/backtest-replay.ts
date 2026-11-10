import fs from 'node:fs';
import path from 'node:path';
import { replayAt, type ReplaySnapshot } from '../src/lib/backtest';
import { MODEL_VERSION, type FredSnapshot } from '../src/lib/macro-context';
import type { PriceDataset } from '../src/lib/market-evidence';
import type { MacroEvent } from '../src/lib/types';
import { PRICE_INSTRUMENTS, readAvailability, readPriceFile, type InputProvenance } from './lib/provenance';

const root = path.join('data','validation-v3');
const fredDir = path.join(root,'fred');
if (!fs.existsSync(fredDir)) throw new Error('Acquire point-in-time FRED snapshots first. Legacy calendar files are not accepted.');
const fred: FredSnapshot[] = fs.readdirSync(fredDir).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(fredDir,name),'utf8')))
  .filter(snapshot=>snapshot.schemaVersion===1).sort((a,b)=>a.availableAt.localeCompare(b.availableAt));
// Read each price file once, recording exactly what this replay saw.
const priceFiles=Object.fromEntries(PRICE_INSTRUMENTS.map(name=>[name,readPriceFile(root,name)]));
const loadPrices=(name:string):PriceDataset|undefined=>priceFiles[name]?.dataset;
const markets={DXY:loadPrices('DXY'),US10Y:loadPrices('US10Y')};
const times=[...new Set(['XAUUSD','GBPUSD','US100','DJ30','BTCUSD'].flatMap(symbol=>loadPrices(symbol)?.bars.map(bar=>bar.openTime)??[]))]
 .filter(time=>time>=(fred[0]?.availableAt??'9999')&&Date.parse(time)<=Date.now()).sort();
const archiveFile=path.join(root,'archived-events.json');
const archived:MacroEvent[]=fs.existsSync(archiveFile)?JSON.parse(fs.readFileSync(archiveFile,'utf8')):[];
const provenance:InputProvenance={schemaVersion:1,prices:PRICE_INSTRUMENTS.map(name=>priceFiles[name].input),...readAvailability(root),
 fredSnapshots:fred.length,fredFirstAvailableAt:fred[0]?.availableAt??null,fredLastAvailableAt:fred.at(-1)?.availableAt??null,archivedEvents:archived.length};
const snapshots:ReplaySnapshot[]=[];
for(const asOf of times){
 const known=fred.findLast(snapshot=>snapshot.availableAt<=asOf)??null;
 snapshots.push(...replayAt(asOf,known,markets,archived));
}
const manifest={schemaVersion:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),inputProfile:'trend-market-only',
 completeLiveArchive:false,includesArchivedEvents:archived.length>0,selectionPolicy:'shared production scorer; completed bars; prior-day ALFRED vintage',
 provenance,snapshotTimes:times.length,snapshots};
fs.writeFileSync(path.join(root,'replay.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({modelVersion:MODEL_VERSION,times:times.length,rows:snapshots.length,first:times[0],last:times.at(-1),profile:manifest.inputProfile}));
