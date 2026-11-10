import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporalSplit, summarizeRecords, type EvaluationRecord } from '../src/lib/backtest';
import { MODEL_VERSION } from '../src/lib/macro-context';
import { coverageLines, sourceStatement, type InputProvenance } from './lib/provenance';

const file=path.join('data','validation-v3','evaluation.json');
const contents=fs.readFileSync(file,'utf8');
const input=JSON.parse(contents);
if(input.schemaVersion!==1||input.modelVersion!==MODEL_VERSION||input.horizonHours!==4)throw new Error('Evaluation schema/model/horizon mismatch');
const records:EvaluationRecord[]=input.records;
// Coverage comes from the inputs frozen at replay time, never from whatever price files exist now.
const provenance:InputProvenance|undefined=input.provenance;
if(provenance?.schemaVersion!==1||typeof input.replaySha256!=='string')throw new Error('Evaluation has no input provenance; rerun npm run backtest:replay and npm run backtest:returns.');
const coverage=coverageLines(provenance).join('\n');
const split=temporalSplit(records);
const pct=(n:number|null)=>n===null?'N/A':`${(n*100).toFixed(1)}%`;
const bp=(n:number|null)=>n===null?'N/A':`${(n*10000).toFixed(2)}`;
const rows:string[]=[];
const summaries:unknown[]=[];
for(const symbol of ['XAUUSD','GBPUSD','US100','DJ30','BTCUSD']){
 for(const subset of ['all directional','qualified alignment'] as const){
  const development=split.development.filter(row=>row.symbol===symbol&&(subset==='all directional'||row.qualified));
  const holdout=split.holdout.filter(row=>row.symbol===symbol&&(subset==='all directional'||row.qualified));
  const dev=summarizeRecords(development);
  const out=summarizeRecords(holdout);
  const benchmark=dev.n===0?null:(dev.longBaseline!>=dev.shortBaseline!?'always long':'always short');
  const baseline=benchmark==='always long'?out.longBaseline:benchmark==='always short'?out.shortBaseline:null;
  const statisticalCandidate=out.n>=100&&out.days>=30&&out.confidence95!==null&&out.confidence95[0]>0.5&&out.meanNetReturn!>0&&baseline!==null&&out.hitRate!>baseline;
  const status=out.n<100||out.days<30?'insufficient sample':statisticalCandidate?'promising; replication required':'edge not demonstrated';
  summaries.push({symbol,subset,development:dev,holdout:out,benchmark,baseline,status,probability:null});
  rows.push(`| ${symbol} | ${subset} | ${dev.n} | ${out.n} | ${out.days} | ${pct(out.hitRate)} | ${out.confidence95?out.confidence95.map(pct).join('–'):'N/A'} | ${bp(out.meanNetReturn)} | ${pct(baseline)} (${benchmark??'no baseline'}) | ${status} |`);
 }
}
const rejected:Record<string,number>={};
for(const row of records)if(row.rejection)rejected[row.rejection]=(rejected[row.rejection]??0)+1;
const hash=createHash('sha256').update(contents).digest('hex');
const report=`# Four-hour macro validation\n\nGenerated ${new Date().toISOString()}. Model: ${MODEL_VERSION}.\n\n## Verdict\n\nNo high-probability claim is authorized by this run. This is a diagnostic of the ${input.inputProfile} input profile. Full historical news and consensus-surprise coverage is not available, and the assumed trading costs have not been matched to the user's broker. The dashboard therefore continues to display rule alignment with probability unvalidated.\n\n## Method\n\n- Prices are hourly bars. Entry uses the first bar open strictly after the prediction, delayed by no more than one bar. Exit is exactly four continuous hours later. Session/weekend gaps and incomplete windows are rejected. Daily bars are never substituted.\n- Only closed market bars and an ALFRED vintage available before the prediction enter the score. Both FRED real-time date bounds are fixed. Date-only FRED vintages become usable the following UTC day.\n- Trend transformations, context selection, freshness, and scoring use the same functions as production. Archived events, when available, must carry their actual availability timestamp.\n- The first 70% of unique prediction timestamps form development. The last 30% form the untouched chronological holdout; all assets sharing a timestamp stay together. Development labels reaching the cutoff are purged. Cutoff: ${split.cutoff??'none'}.\n- Metrics use non-overlapping four-hour positions per asset and subset. Leaning bullish/bearish predictions retain their sign. Neutral predictions are excluded. Qualification is frozen: alignment status aligned and conviction high. Thresholds were not tuned to this holdout.\n- Round-trip cost assumption: ${input.costBps} basis points, subtracted from directional returns. These are illustrative costs, not a broker-specific P&L model. MAE uses only bars during the position.\n- The always-long or always-short baseline is selected on development and evaluated on matching holdout entry times. Wilson 95% intervals are approximate binomial intervals; residual serial dependence can make them optimistic.\n- A research candidate requires at least 100 non-overlapping holdout positions over 30 days, a Wilson lower bound above 50%, positive mean net return, and improvement over the development-selected baseline. This alone is not a calibrated live probability or a guarantee of profit.\n\n## Results\n\n| Asset | Subset | Dev N | Holdout N | Holdout days | Net hit rate | 95% interval | Mean net bps | Baseline | Assessment |\n|---|---|---:|---:|---:|---:|---|---:|---|---|\n${rows.join('\n')}\n\n## Coverage and reproducibility\n\n${coverage}\n\n${sourceStatement(provenance)} FRED: ${provenance.fredSnapshots} point-in-time snapshots available ${provenance.fredFirstAvailableAt??'N/A'} to ${provenance.fredLastAvailableAt??'N/A'}; archived events: ${provenance.archivedEvents}. These checks do not certify provider accuracy or broker execution quality.\n\nTotal prediction rows: ${records.length}. Rejections: ${JSON.stringify(rejected)}.\n\nEvaluation SHA-256: ${hash}. Replay SHA-256: ${input.replaySha256}. Price input SHA-256: ${provenance.prices.filter(p=>p.sha256).map(p=>`${p.instrument} ${p.sha256!.slice(0,12)}`).join(', ')}.\n\nRaw snapshots, intraday prices, replay and evaluation are in data/validation-v3/ (local, ignored by Git). Existing legacy reports and data were not used. Rerun npm run backtest:replay, npm run backtest:returns and npm run backtest:report after acquisition; use --cost-bps=N with the returns command to inspect cost sensitivity.\n\nLonger licensed intraday history, point-in-time consensus releases and archived news, broker-specific costs, and a new untouched period are required before promoting this diagnostic into full production validation.\n`;
fs.writeFileSync('docs/backtest-report-v3.md',report);
fs.writeFileSync(path.join('data','validation-v3','summary.json'),JSON.stringify({schemaVersion:1,modelVersion:MODEL_VERSION,cutoff:split.cutoff,evaluationHash:hash,summaries},null,2)+'\n');
console.log(report);
