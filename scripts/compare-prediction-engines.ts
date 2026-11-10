/** Offline comparison. No provider requests, fitting, or future news reconstruction. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scoreMacroAlignment } from '../src/lib/alignment';
import { buildMacroInputs, MODEL_VERSION, type FredSnapshot } from '../src/lib/macro-context';
import { buildMarketEvents, type PriceDataset } from '../src/lib/market-evidence';
import { classifyHeadline } from '../src/lib/api/classifier';
import { evaluateFourHours, nonOverlapping, type EvaluationRecord } from '../src/lib/backtest';
import type { AssetSymbol, BiasResult, MacroContext, MacroEvent } from '../src/lib/types';

const revisions = ['02bd9e5', '178457f']; // Immediately before normalization; inspected production.
const symbols: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
const files = ['engine.ts', 'alignment.ts', 'macro-context.ts', 'rules.ts', 'types.ts'];
type Scorer = typeof scoreMacroAlignment;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);

async function main() {
  const root = path.resolve(arg('data') ?? 'data/validation-v3');
  const out = path.resolve(arg('output') ?? '.artifacts/prediction-comparison.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const scorers: Record<string, Scorer> = {};
  const sources: Record<string, unknown> = {};
  for (const revision of revisions) {
    const sha = execFileSync('git', ['rev-parse', revision], { encoding: 'utf8' }).trim();
    const dir = path.resolve('.artifacts', 'prediction-baselines', sha);
    fs.mkdirSync(dir, { recursive: true });
    const sourceHashes: Record<string, string> = {};
    for (const file of files) {
      const source = execFileSync('git', ['show', `${sha}:src/lib/${file}`], { encoding: 'utf8' });
      fs.writeFileSync(path.join(dir, file), source);
      sourceHashes[file] = hash(source);
    }
    scorers[revision] = (await import(pathToFileURL(path.join(dir, 'alignment.ts')).href)).scoreMacroAlignment;
    sources[revision] = { sha, sourceHashes };
  }
  scorers.corrected = scoreMacroAlignment;
  sources.corrected = { modelVersion: MODEL_VERSION, sourceHashes: Object.fromEntries([...files, 'api/classifier.ts']
    .map(file => [file, hash(read(path.join('src/lib', file)))])) };

  const fredFiles = fs.readdirSync(path.join(root, 'fred')).filter(file => file.endsWith('.json')).sort();
  const vintages: FredSnapshot[] = fredFiles.map(file => JSON.parse(read(path.join(root, 'fred', file))));
  if (vintages.some(snapshot => snapshot.schemaVersion !== 1)) throw new Error('Unsupported vintage schema');
  vintages.sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  const prices: Record<string, PriceDataset | undefined> = {};
  const priceHashes: Record<string, string | null> = {};
  for (const instrument of [...symbols, 'DXY', 'US10Y']) {
    const file = path.join(root, 'prices', `${instrument}.json`);
    const content = fs.existsSync(file) ? read(file) : null;
    prices[instrument] = content ? JSON.parse(content) : undefined;
    priceHashes[instrument] = content ? hash(content) : null;
  }
  const times = [...new Set(symbols.flatMap(symbol => prices[symbol]?.bars.map(bar => bar.openTime) ?? []))]
    .filter(time => time >= vintages[0].availableAt && Date.parse(time) <= Date.now()).sort();
  const counts = Object.fromEntries(Object.keys(scorers).map(key => [key, { rows: 0, high: 0, sub50High: 0, aligned: 0, signals: 0 }]));
  const evaluated: Record<string, EvaluationRecord[]> = Object.fromEntries(Object.keys(scorers).map(key => [key, []]));
  let changedScores = 0, changedDirections = 0, changedPercentages = 0;
  const examples: unknown[] = [];
  for (const asOf of times) {
    const vintage = vintages.findLast(snapshot => snapshot.availableAt <= asOf) ?? null;
    const { context, events } = buildMacroInputs(vintage, asOf);
    const inputs = [...events, ...buildMarketEvents({ DXY: prices.DXY, US10Y: prices.US10Y }, asOf)];
    if (inputs.some(event => Date.parse(event.timestamp) > Date.parse(asOf))) throw new Error('Future input');
    const readings: Record<string, BiasResult[]> = {};
    for (const [key, score] of Object.entries(scorers)) {
      readings[key] = score(inputs, context, asOf).filter(result => symbols.includes(result.symbol));
      for (const result of readings[key]) {
        const count = counts[key];
        count.rows++;
        count.high += Number(result.conviction === 'high');
        count.sub50High += Number(result.conviction === 'high' && Math.abs(result.biasPercent) < 50);
        count.aligned += Number(result.alignment?.status === 'aligned');
        count.signals += Number(result.signal !== 'neutral');
        // One unchanged four-hour execution evaluator for every version. Its wrapper
        // schema version is current; the result and source revision remain untouched.
        evaluated[key].push(evaluateFourHours({ schemaVersion: 1, modelVersion: MODEL_VERSION,
          timestamp: asOf, inputProfile: 'trend-market-only', result }, prices[result.symbol] ?? null));
      }
    }
    for (const old of readings['178457f']) {
      const corrected = readings.corrected.find(result => result.symbol === old.symbol)!;
      changedScores += Number(old.biasScore !== corrected.biasScore);
      changedDirections += Number(old.direction !== corrected.direction);
      changedPercentages += Number(old.biasPercent !== corrected.biasPercent);
      if (examples.length < 5 && old.conviction !== corrected.conviction) examples.push({ asOf, symbol: old.symbol,
        before: pick(old), corrected: pick(corrected) });
    }
  }
  const outcomes = Object.fromEntries(Object.entries(evaluated).map(([key, rows]) => [key, Object.fromEntries(symbols.map(symbol => {
    const matched = nonOverlapping(rows.filter(row => row.symbol === symbol));
    return [symbol, { n: matched.length, positiveNetReturns: matched.filter(row => row.netReturn! > 0).length }];
  }))]));

  const liveFile = arg('capture');
  let capture: unknown = null;
  if (liveFile) {
    const content = read(liveFile);
    const frozen = JSON.parse(content) as { capturedAt: string; context: MacroContext; events: MacroEvent[] };
    const asOf = frozen.capturedAt;
    if (!Number.isFinite(Date.parse(asOf))) throw new Error('Capture requires a receipt timestamp');
    // Reclassify only articles actually present in the capture. Do not invent missing
    // feed items or backdate this capture to a pre-release prediction.
    const articles = new Set<string>();
    const sourceSignals = new Set<string>();
    const correctedInputs = frozen.events.flatMap(event => {
      if (event.evidenceType !== 'headline') return [event];
      const identity = `${event.sourceName}:${event.url ?? event.description}:${event.timestamp}`;
      if (articles.has(identity)) return [];
      articles.add(identity);
      return classifyHeadline(event.description).filter(signal => {
        // Preserve the live adapters' per-source, first-signal selection on the
        // retained articles; the original API preserves their input order.
        const key = `${event.sourceName}:${signal.category}:${signal.value}:${signal.country ?? ''}`;
        if (sourceSignals.has(key)) return false;
        sourceSignals.add(key);
        return true;
      }).map(signal => ({ ...event, ...signal, id: `${event.id}:${signal.category}:${signal.value}` }));
    });
    const readings = Object.fromEntries(Object.entries(scorers).map(([key, score]) => [key,
      score(key === 'corrected' ? correctedInputs : frozen.events, frozen.context, asOf).map(pick)]));
    capture = { capturedAt: asOf, sha256: hash(content), readings,
      scope: 'Captured post-release inputs only; reclassification cannot recover discarded feed articles. No pre-release performance claim.' };
  }
  const report = { sources, historical: { profile: 'trend-market-only', archivedNewsUsed: 0,
    policy: 'Prior-day ALFRED vintage; completed market bars; shared as-of input selection. No forecast consensus or news invented.',
    fredSnapshots: vintages.length, fredSha256: hash(fredFiles.map(file => read(path.join(root, 'fred', file))).join('\n')),
    priceHashes, times: times.length, first: times[0], last: times.at(-1), counts,
    productionVsCorrected: { changedScores, changedDirections, changedPercentages }, examples,
    outcomes, outcomePolicy: 'All directional, non-overlapping four-hour windows; 5 bps illustrative round-trip cost. Descriptive reuse of previously inspected data, not untouched validation.' }, capture };
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, historical: report.historical, capture }, null, 2));
}

function pick(result: BiasResult) {
  return { symbol: result.symbol, score: result.biasScore, percent: result.biasPercent, direction: result.direction,
    conviction: result.conviction, signal: result.signal, status: result.alignment?.status };
}
main().catch(error => { console.error(error); process.exitCode = 1; });
