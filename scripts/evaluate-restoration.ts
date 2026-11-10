/** Previously inspected development data only. No fitting, backfilled headlines or holdout claims. */
import fs from 'node:fs';
import path from 'node:path';
import { researchModels, readJson, sha256 } from './lib/research-models';
import { buildMacroInputs, type FredSnapshot } from '../src/lib/macro-context';
import { buildMarketEvents, type PriceDataset } from '../src/lib/market-evidence';
import { directionSign, evaluateDirectionFourHours, nonOverlapping, type EvaluationRecord } from '../src/lib/backtest';
import { pairedDirectionDifference, researchSummary, type ResearchRow } from '../src/lib/research-evaluation';
import type { AssetSymbol, BiasResult } from '../src/lib/types';

const symbols: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
const arg = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
async function main() {
  const root = path.resolve(arg('data', 'data/validation-v3'));
  const output = path.resolve(arg('output', '.artifacts/restoration-evaluation.json'));
  const { scorers, provenance } = await researchModels();
  const files = fs.readdirSync(path.join(root, 'fred')).filter(file => file.endsWith('.json')).sort();
  const vintages = files.map(file => readJson<FredSnapshot>(path.join(root, 'fred', file))).sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  const dataHashes = Object.fromEntries(files.map(file => [`fred/${file}`, sha256(fs.readFileSync(path.join(root, 'fred', file), 'utf8'))]));
  const prices = Object.fromEntries([...symbols, 'DXY', 'US10Y'].map(symbol => {
    const file = path.join(root, 'prices', `${symbol}.json`);
    if (!fs.existsSync(file)) return [symbol, null];
    dataHashes[`prices/${symbol}`] = sha256(fs.readFileSync(file, 'utf8'));
    return [symbol, readJson<PriceDataset>(file)];
  }));
  const times = [...new Set(symbols.flatMap(symbol => prices[symbol]?.bars.map(bar => bar.openTime) ?? []))]
    .filter(time => time >= vintages[0].availableAt && Date.parse(time) <= Date.now()).sort();
  const profiles: Record<string, unknown> = {};
  const outcomes = new Map<string, EvaluationRecord>();
  const outcomeFor = (time: string, result: BiasResult) => {
    const key = `${time}:${result.symbol}:${directionSign(result.direction)}`;
    let outcome = outcomes.get(key);
    if (!outcome) { outcome = evaluateDirectionFourHours(time, result, prices[result.symbol] ?? null); outcomes.set(key, outcome); }
    return { ...outcome, direction: result.direction, score: result.biasScore, regime: result.alignment?.context.regime ?? 'unknown',
      qualified: result.alignment?.status === 'aligned' && result.conviction === 'high' };
  };
  for (const profile of ['shared-market', 'modern-trend-market'] as const) {
    // Reference has no modern trend vocabulary; include it only on mutually supported inputs.
    const models = Object.entries(scorers).filter(([name]) => profile === 'shared-market' || name !== 'reference');
    const rows = Object.fromEntries(models.map(([name]) => [name, Object.fromEntries(symbols.map(symbol => [symbol, [] as ResearchRow[]]))]));
    const counts = Object.fromEntries(models.map(([name]) => [name, Object.fromEntries(symbols.map(symbol => [symbol, { directional: 0, qualified: 0, high: 0, sub50High: 0, changedDirection: 0 }]))]));
    const windows = Object.fromEntries(symbols.map(symbol => [symbol, [] as ReturnType<typeof evaluateDirectionFourHours>[]]));
    for (const time of times) {
      const known = vintages.findLast(snapshot => snapshot.availableAt <= time) ?? null;
      const { events, context } = buildMacroInputs(known, time);
      const inputs = [...(profile === 'modern-trend-market' ? events : []), ...buildMarketEvents({ DXY: prices.DXY ?? undefined, US10Y: prices.US10Y ?? undefined }, time)];
      if (inputs.some(event => Date.parse(event.timestamp) > Date.parse(time))) throw new Error('Future input');
      const outputs = Object.fromEntries(models.map(([name, score]) => [name, score(inputs, context, time)]));
      for (const symbol of symbols) {
        const base = outputs.currentRepair.find(row => row.symbol === symbol)!;
        // Long baseline used solely to define valid windows, independent of the model's signal.
        windows[symbol].push(outcomeFor(time, { ...base, direction: 'bullish' }));
        for (const [name] of models) {
          const result: BiasResult = outputs[name].find(row => row.symbol === symbol)!;
          const count = counts[name][symbol];
          count.directional += Number(directionSign(result.direction) !== 0);
          count.qualified += Number(result.alignment?.status === 'aligned' && result.conviction === 'high');
          count.high += Number(result.conviction === 'high');
          count.sub50High += Number(result.conviction === 'high' && Math.abs(result.biasPercent) < 50);
          count.changedDirection += Number(result.direction !== base.direction);
          rows[name][symbol].push({ result, outcome: outcomeFor(time, result) });
        }
      }
    }
    const perAsset: Record<string, unknown> = {};
    for (const symbol of symbols) {
      const commonTimes = new Set(nonOverlapping(windows[symbol]).map(row => row.timestamp));
      const common = Object.fromEntries(models.map(([name]) => [name, rows[name][symbol].filter(row => commonTimes.has(row.outcome.timestamp))]));
      const eligible = windows[symbol].filter(row => !row.rejection).length;
      const rejections = windows[symbol].reduce((acc, row) => { if (row.rejection) acc[row.rejection] = (acc[row.rejection] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      perAsset[symbol] = { rejections, models: Object.fromEntries(models.map(([name]) => [name, {
        ...counts[name][symbol], signalFrequency: counts[name][symbol].directional / times.length,
        qualifiedFrequency: counts[name][symbol].qualified / times.length,
        direction: researchSummary(common[name], times.length, eligible),
        qualified: name === 'reference' ? null : researchSummary(common[name], times.length, eligible, true),
        pairedVsCurrent: pairedDirectionDifference(common[name], common.currentRepair),
      }])) };
    }
    profiles[profile] = perAsset;
  }
  const report = { generatedAt: new Date().toISOString(), purpose: 'Descriptive development comparison, not independent validation',
    first: times[0], last: times.at(-1), scheduledPerAsset: times.length, horizonHours: 4, roundTripCostBps: 5,
    protocol: 'Same as-of inputs and price-only nonoverlap windows. Next hourly open strictly after prediction; four contiguous hours. Flat outcomes count as misses. Frequency counts all scheduled timestamps, including missing-price periods. Paired deltas use jointly directional windows; differing abstentions reported separately. All existing data previously inspected. Daily block bootstrap is descriptive and does not remove multi-day dependence or selection bias. Index/FX prices are directional proxies, not guaranteed executable fills; costs illustrative.',
    limitations: ['No archived news or consensus, so full reference engine and pre-release usefulness cannot be reconstructed.', 'Gold prices unavailable. No untouched historical holdout remains.', 'Modern transforms are not relabeled as old surprises. Reference only evaluated on shared market profile.', 'Qualified signals and macro direction are separate; technical-entry performance is not evaluated.'],
    provenance, dataHashes, profiles };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, first: report.first, last: report.last, scheduled: times.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
