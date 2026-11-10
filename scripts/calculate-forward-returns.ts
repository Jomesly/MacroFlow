import fs from 'node:fs';
import path from 'node:path';
import { evaluateFourHours, type ReplaySnapshot } from '../src/lib/backtest';
import { MODEL_VERSION } from '../src/lib/macro-context';
import type { PriceDataset } from '../src/lib/market-evidence';
import { changedPriceInputs, PRICE_INSTRUMENTS, readPriceFile, sha256 } from './lib/provenance';

const root=path.join('data','validation-v3');
const replayContents=fs.readFileSync(path.join(root,'replay.json'),'utf8');
const input=JSON.parse(replayContents);
if(input.schemaVersion!==1||input.modelVersion!==MODEL_VERSION)throw new Error('Replay schema/model mismatch; rerun the current replay.');
if(input.provenance?.schemaVersion!==1)throw new Error('Replay has no input provenance; rerun npm run backtest:replay.');
const costBps=Number(process.argv.find(arg=>arg.startsWith('--cost-bps='))?.split('=')[1]??5);
if(!Number.isFinite(costBps)||costBps<0)throw new Error('Invalid cost-bps');
const priceFiles=PRICE_INSTRUMENTS.map(symbol=>readPriceFile(root,symbol));
const changed=changedPriceInputs(input.provenance.prices,priceFiles.map(file=>file.input));
if(changed.length)throw new Error(`Price files changed since replay (${changed.join(', ')}); rerun npm run backtest:replay first.`);
const prices:Record<string,PriceDataset>={};
for(const file of priceFiles)if(file.dataset)prices[file.input.instrument]=file.dataset;
const records=(input.snapshots as ReplaySnapshot[]).map(snapshot=>evaluateFourHours(snapshot,prices[snapshot.result.symbol]??null,costBps));
const output={schemaVersion:1,modelVersion:MODEL_VERSION,generatedAt:new Date().toISOString(),horizonHours:4,costBps,costsVerified:false,
 inputProfile:input.inputProfile,completeLiveArchive:input.completeLiveArchive,replaySha256:sha256(replayContents),provenance:input.provenance,records};
fs.writeFileSync(path.join(root,'evaluation.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({records:records.length,valid:records.filter(record=>record.netReturn!==null).length,qualified:records.filter(record=>record.qualified&&record.netReturn!==null).length,costBps}));
