/** Offline, one-change-at-a-time diagnostics. Never imported by the live engine. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scoreMacroAlignment } from '../src/lib/alignment';
import { maxBiasPoints } from '../src/lib/engine';
import { buildMacroInputs, selectEventsAsOf, type FredSnapshot } from '../src/lib/macro-context';
import { buildMarketEvents, type PriceDataset } from '../src/lib/market-evidence';
import { contextFixture } from '../src/lib/__tests__/fixtures/macro';
import type { AssetSymbol, MacroContext, MacroEvent } from '../src/lib/types';
import { RESEARCH_POLICIES } from '../src/lib/scoring-policy';

const symbols: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const arg = (key: string, fallback: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function main() {
  const root = path.resolve(arg('data', 'data/validation-v3'));
  const output = path.resolve(arg('output', '.artifacts/engine-change-audit.json'));
  const sources = Object.fromEntries(['engine.ts', 'alignment.ts', 'bias-reading.ts', 'rules.ts', 'types.ts', 'macro-context.ts', 'scoring-policy.ts']
    .map(file => [file, read(path.join('src/lib', file))]));
  const variants = RESEARCH_POLICIES;
  const scorers: Record<string, typeof scoreMacroAlignment> = Object.fromEntries(Object.entries(variants)
    .map(([name, policy]) => [name, (events, context, asOf, symbol) => scoreMacroAlignment(events, context, asOf, symbol, policy)]));
  const asOf = '2026-11-10T12:00:00.000Z';
  const { context, events: trends } = buildMacroInputs(contextFixture(), asOf);
  const event = (category: MacroEvent['category'], value: string, evidenceType: MacroEvent['evidenceType']): MacroEvent => ({
    id: `${category}:${value}`, category, value, evidenceType, timestamp: asOf, title: value, description: value, country: 'US', impact: 'high',
  });
  const example = (name: string, inputs: MacroEvent[], symbol: AssetSymbol, ctx: MacroContext = context) => ({ name, inputs, symbol, regime: ctx.regime,
    results: Object.fromEntries(Object.entries(scorers).map(([key, score]) => {
      const result = score(inputs, ctx, asOf, symbol)[0];
      return [key, { points: result.biasScore, percent: result.biasPercent, direction: result.direction,
        conviction: result.conviction, signal: result.signal, scoredEvents: result.eventCount }];
    })),
  });
  const activity = [event('employment', 'strong', 'surprise'), event('pmi', 'beat', 'surprise')];
  const examples = [
    example('Gold: dovish Fed, weaker dollar, cool CPI surprise', [event('fed_tone', 'dovish', 'headline'),
      event('dollar_strength', 'weak', 'market'), event('inflation', 'low', 'surprise')], 'XAUUSD'),
    example('Gold: headline reports cooling CPI, no verified consensus', [event('inflation', 'low', 'headline')], 'XAUUSD'),
    example('Gold: transformed FRED trends only (constructed vintage)', trends, 'XAUUSD'),
    ...(['rates_sensitive', 'growth_sensitive', 'mixed', 'unknown'] as const).map(regime =>
      example(`Nasdaq: stronger activity, ${regime}`, activity, 'US100', { ...context, regime, complete: regime !== 'unknown' })),
  ];
  const files = fs.readdirSync(path.join(root, 'fred')).filter(file => file.endsWith('.json')).sort();
  const vintages: FredSnapshot[] = files.map(file => JSON.parse(read(path.join(root, 'fred', file))));
  vintages.sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  const prices = Object.fromEntries([...symbols, 'DXY', 'US10Y'].map(symbol => {
    const file = path.join(root, 'prices', `${symbol}.json`);
    return [symbol, fs.existsSync(file) ? JSON.parse(read(file)) as PriceDataset : undefined];
  }));
  const times = [...new Set(symbols.flatMap(symbol => prices[symbol]?.bars.map(bar => bar.openTime) ?? []))]
    .filter(time => time >= vintages[0].availableAt && Date.parse(time) <= Date.now()).sort();
  const counts = Object.fromEntries(Object.keys(scorers).map(key => [key, { changedPoints: 0, changedZones: 0, oppositeSigns: 0,
    zeroToNonzero: 0, highConviction: 0, perAsset: Object.fromEntries(symbols.map(symbol => [symbol, { changedPoints: 0, oppositeSigns: 0 }])) }]));
  const regimes: Record<string, number> = {};
  for (const time of times) {
    const known = vintages.findLast(snapshot => snapshot.availableAt <= time) ?? null;
    const input = buildMacroInputs(known, time);
    regimes[input.context.regime] = (regimes[input.context.regime] ?? 0) + 1;
    const selected = selectEventsAsOf([...input.events, ...buildMarketEvents({ DXY: prices.DXY, US10Y: prices.US10Y }, time)], time);
    if (selected.some(row => Date.parse(row.timestamp) > Date.parse(time))) throw new Error('Future input');
    const baseline = scorers.currentRepair(selected, input.context, time).filter(result => symbols.includes(result.symbol));
    for (const [name, score] of Object.entries(scorers)) {
      const results = score(selected, input.context, time).filter(result => symbols.includes(result.symbol));
      for (const row of results) {
        const current = baseline.find(result => result.symbol === row.symbol)!;
        const count = counts[name];
        count.changedPoints += Number(row.biasScore !== current.biasScore);
        count.changedZones += Number(row.direction !== current.direction);
        count.oppositeSigns += Number(row.biasScore * current.biasScore < 0);
        count.zeroToNonzero += Number(current.biasScore === 0 && row.biasScore !== 0);
        count.highConviction += Number(row.conviction === 'high');
        count.perAsset[row.symbol].changedPoints += Number(row.biasScore !== current.biasScore);
        count.perAsset[row.symbol].oppositeSigns += Number(row.biasScore * current.biasScore < 0);
      }
    }
  }
  const report = { scope: 'One-change-at-a-time behavior diagnostics, not fitted models, forecast validation or a recreation of the complete reference pipeline.',
    sources: Object.fromEntries(Object.entries(sources).map(([file, value]) => [file, sha256(value)])), variants,
    capacities: Object.fromEntries(symbols.map(symbol => [symbol, { categoryCapacity: maxBiasPoints(symbol),
      unroundedHalfCapacity: maxBiasPoints(symbol) / 2, firstIntegerPointsDisplaying50: Math.ceil(0.495 * maxBiasPoints(symbol)) }])),
    examples, historical: { rows: times.length * symbols.length, times: times.length, first: times[0], last: times.at(-1), regimes, counts,
      limitations: 'No historical news/consensus archive; headline-filter ablation cannot be assessed here. Existing inspected data; no outcome-based model selection.' } };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, capacities: report.capacities, historical: report.historical }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
