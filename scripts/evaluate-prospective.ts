/** Refuses to open the registered holdout early. No historical records can enter this evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './lib/research-models';
import { digest, captureEligibility, type PredictionInputs } from './lib/prediction-log';
import { directionSign, evaluateDirectionFourHours, nonOverlapping } from '../src/lib/backtest';
import { researchSummary, pairedDirectionDifference, type ResearchRow } from '../src/lib/research-evaluation';
import type { PriceDataset } from '../src/lib/market-evidence';
import type { AssetSymbol, BiasResult } from '../src/lib/types';

interface Capture {
  modelHash: string; predictionAt: string; receivedAt: string; holdout: boolean; inputs: PredictionInputs;
  inputsHash: string; payloadHash: string; outputs: Record<string, Record<string, BiasResult[]>>;
}
const arg = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
async function main() {
  const dir = path.resolve(arg('out', 'data/prediction-research'));
  const manifest = readJson<{ modelHash: string; registeredAt: string; protocol: { startsAt: string; endsAt: string; minimumNonoverlappingPairsPerAsset: number; minimumObservedDaysPerAsset: number } }>(path.join(dir, 'manifest.json'));
  const protocol = manifest.protocol;
  if (Date.now() < Date.parse(protocol.endsAt)) throw new Error(`Holdout remains sealed until ${protocol.endsAt}`);
  if (!(manifest.registeredAt < protocol.startsAt)) throw new Error('Protocol was not registered before the holdout');
  const excluded: Record<string, number> = {};
  const captures: Capture[] = [];
  for (const file of fs.readdirSync(path.join(dir, 'captures')).filter(file => file.endsWith('.json')).sort()) {
    const record = readJson<Capture>(path.join(dir, 'captures', file));
    const { payloadHash, ...payload } = record;
    const reason = payloadHash !== digest(payload) || record.inputsHash !== digest(record.inputs) ? 'integrity'
      : record.modelHash !== manifest.modelHash ? 'model_changed'
      : record.predictionAt < protocol.startsAt || record.predictionAt >= protocol.endsAt ? 'outside_period'
      : !record.holdout || !captureEligibility(record.inputs, record.receivedAt).eligible ? 'unhealthy' : null;
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; continue; }
    captures.push(record);
  }
  const expectedHours = (Date.parse(protocol.endsAt) - Date.parse(protocol.startsAt)) / 3_600_000;
  const perAsset: Record<string, unknown> = {};
  for (const symbol of ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] as AssetSymbol[]) {
    const file = path.join(path.resolve(arg('prices', 'data/prediction-research/prices')), `${symbol}.json`);
    const prices = fs.existsSync(file) ? readJson<PriceDataset>(file) : null;
    const rows: Record<string, ResearchRow[]> = {};
    const windows = captures.map(capture => {
      for (const [name, results] of Object.entries(capture.outputs['modern-inputs'])) {
        const result = results.find(row => row.symbol === symbol)!;
        (rows[name] ??= []).push({ result, outcome: evaluateDirectionFourHours(capture.predictionAt, result, prices) });
      }
      const base = capture.outputs['modern-inputs'].currentRepair.find(row => row.symbol === symbol)!;
      return evaluateDirectionFourHours(capture.predictionAt, { ...base, direction: 'bullish' }, prices);
    });
    const times = new Set(nonOverlapping(windows).map(row => row.timestamp));
    const common = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.filter(row => times.has(row.outcome.timestamp))]));
    const primary = pairedDirectionDifference(common.restoration ?? [], common.currentRepair ?? [], 0.01);
    perAsset[symbol] = { primary, meetsSampleMinimum: primary.n >= protocol.minimumNonoverlappingPairsPerAsset && primary.days >= protocol.minimumObservedDaysPerAsset,
      models: Object.fromEntries(Object.entries(common).map(([name, values]) => [name, {
        ...researchSummary(values, expectedHours, windows.filter(row => !row.rejection).length),
        signalFrequency: rows[name].filter(row => directionSign(row.result.direction)).length / expectedHours,
        qualified: researchSummary(values, expectedHours, windows.filter(row => !row.rejection).length, true),
      }])) };
  }
  fs.writeFileSync(path.join(dir, 'final-evaluation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), expectedHours,
    healthyCaptures: captures.length, excluded, missingOrIneligibleHours: expectedHours - new Set(captures.map(row => row.predictionAt.slice(0, 13))).size,
    uncertainty: 'Paired daily cluster bootstrap at 99% per original asset. Screening comparison; temporal dependence, proxy fills and technical execution remain limitations.', perAsset }, null, 2) + '\n');
  console.log('Wrote final-evaluation.json. Inspect coverage, sample requirements and intervals before making any claim.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Prospective evaluation failed'); process.exitCode = 1; });
