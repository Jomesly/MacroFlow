/** Controlled text replay from retained articles; never invents historical news. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { classifyHeadline } from '../src/lib/api/classifier';
import { scoreMacroAlignment } from '../src/lib/alignment';
import { RESEARCH_POLICIES } from '../src/lib/scoring-policy';
import { buildMacroInputs, selectEventsAsOf, type FredSnapshot } from '../src/lib/macro-context';
import { buildMarketEvents, type PriceDataset } from '../src/lib/market-evidence';
import { readJson, sha256 } from './lib/research-models';
import type { BiasResult, MacroEvent, MacroContext } from '../src/lib/types';

const priorSha = 'ddf155b';
const arg = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const pick = (row: BiasResult) => ({ symbol: row.symbol, net: row.scoring?.netPoints, percent: row.biasPercent, direction: row.direction, conviction: row.conviction,
  agreement: row.confirmationRatio, categoryPoints: row.scoring?.categoryPoints });

async function main() {
  const baselineDir = path.resolve('.artifacts/asset-news-baseline');
  const oldHashes: Record<string, string> = {};
  for (const file of ['api/classifier.ts', 'engine.ts', 'alignment.ts', 'macro-context.ts', 'rules.ts', 'types.ts', 'bias-reading.ts', 'scoring-policy.ts']) {
    const source = execFileSync('git', ['show', `${priorSha}:src/lib/${file}`], { encoding: 'utf8' });
    const dest = path.join(baselineDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, source);
    oldHashes[file] = sha256(source);
  }
  const oldClassify: typeof classifyHeadline = (await import(pathToFileURL(path.join(baselineDir, 'api/classifier.ts')).href)).classifyHeadline;
  const oldScore: typeof scoreMacroAlignment = (await import(pathToFileURL(path.join(baselineDir, 'alignment.ts')).href)).scoreMacroAlignment;
  const classifiers: Record<string, typeof classifyHeadline> = {
    before: oldClassify,
    equitySubjectsOnly: text => [...oldClassify(text).filter(row => row.category !== 'risk_sentiment'), ...classifyHeadline(text).filter(row => row.category === 'risk_sentiment')],
    cryptoScopeOnly: text => [...oldClassify(text).filter(row => row.category !== 'crypto_regulation'), ...classifyHeadline(text).filter(row => row.category === 'crypto_regulation')],
    policyTargetsOnly: text => [...oldClassify(text).filter(row => !row.category.endsWith('_tone')), ...classifyHeadline(text).filter(row => row.category.endsWith('_tone'))],
    allFixes: classifyHeadline,
  };
  const capturePath = path.resolve(arg('capture', 'data/prediction-research/captures/2026-11-10T15.json'));
  const capture = readJson<{ predictionAt: string; inputs: { events: MacroEvent[]; context: MacroContext } }>(capturePath);
  const asOf = capture.predictionAt;
  const articles = [...new Map(capture.inputs.events.filter(row => row.evidenceType === 'headline')
    .map(row => [`${row.sourceName}:${row.url ?? row.description}:${row.timestamp}`, row])).values()];
  const structured = capture.inputs.events.filter(row => row.evidenceType !== 'headline');
  const replay = (classifier: typeof classifyHeadline) => {
    const seen = new Set<string>();
    return [...structured, ...articles.flatMap(article => classifier(article.description).filter(signal => {
      const key = `${article.sourceName}:${signal.category}:${signal.value}:${signal.country ?? ''}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).map(signal => ({ ...article, ...signal, id: `${article.id}:${signal.category}:${signal.value}` })))];
  };
  const captured = Object.fromEntries(Object.entries(classifiers).map(([name, classifier]) => {
    const inputs = replay(classifier);
    return [name, { inputCount: inputs.length, inputHash: sha256(JSON.stringify(inputs)),
      current: scoreMacroAlignment(inputs, capture.inputs.context, asOf).filter(row => ['GBPUSD', 'BTCUSD'].includes(row.symbol)).map(pick),
      restoration: scoreMacroAlignment(inputs, capture.inputs.context, asOf, undefined, RESEARCH_POLICIES.restoration).filter(row => ['GBPUSD', 'BTCUSD'].includes(row.symbol)).map(pick) }];
  }));
  const examples = ['Bank of England cuts its inflation forecast', 'SEC approves new stock exchange rules', 'SEC denies Bitcoin ETF approval',
    'SEC has not approved a Bitcoin ETF', 'Bitcoin ETF approval expected next month', 'Bank of England cuts interest rates', 'SEC approves spot Bitcoin ETF']
    .map(text => ({ text, before: oldClassify(text), after: classifyHeadline(text) }));
  const changedArticles = articles.flatMap(article => {
    const compact = (rows: ReturnType<typeof classifyHeadline>) => rows.map(row => `${row.category}:${row.value}`).sort();
    const before = compact(oldClassify(article.description)), after = compact(classifyHeadline(article.description));
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ text: article.description, timestamp: article.timestamp, before, after }];
  });
  const root = path.resolve(arg('data', 'C:/CodingProjects/MacroFlow/data/validation-v3'));
  const vintages = fs.readdirSync(path.join(root, 'fred')).filter(file => file.endsWith('.json')).map(file => readJson<FredSnapshot>(path.join(root, 'fred', file)))
    .sort((a, b) => a.availableAt.localeCompare(b.availableAt));
  const prices = Object.fromEntries(['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD', 'DXY', 'US10Y'].map(symbol => [symbol, readJson<PriceDataset>(path.join(root, 'prices', `${symbol}.json`))]));
  const times = [...new Set(['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'].flatMap(symbol => prices[symbol].bars.map(bar => bar.openTime)))]
    .filter(time => time >= vintages[0].availableAt && Date.parse(time) <= Date.now()).sort();
  let rows = 0, changed = 0;
  for (const time of times) {
    const { events, context } = buildMacroInputs(vintages.findLast(vintage => vintage.availableAt <= time) ?? null, time);
    const inputs = selectEventsAsOf([...events, ...buildMarketEvents({ DXY: prices.DXY, US10Y: prices.US10Y }, time)], time);
    for (const symbol of ['GBPUSD', 'BTCUSD'] as const) {
      const before = pick(oldScore(inputs, context, time, symbol)[0]);
      const after = pick(scoreMacroAlignment(inputs, context, time, symbol)[0]);
      rows++; changed += Number(JSON.stringify(before) !== JSON.stringify(after));
    }
  }
  if (changed) throw new Error('Unexpected change to trend/market-only scoring; inspect before continuing.');
  const report = { generatedAt: new Date().toISOString(), before: { revision: execFileSync('git', ['rev-parse', priorSha], { encoding: 'utf8' }).trim(), oldHashes },
    afterClassifierHash: sha256(fs.readFileSync('src/lib/api/classifier.ts', 'utf8')), captureHash: sha256(fs.readFileSync(capturePath, 'utf8')),
    asOf, scope: 'Same retained article text for every classifier. Source-level first-signal deduplication retained. Cannot recover discarded articles or reconstruct original provider ordering beyond retained rows.',
    changedArticles, captured, examples,
    historical: { rows, changed, newsArchive: false, outcomeReport: 'docs/restoration-evaluation-2026-11-10.json',
      conclusion: 'No changed historical directions; the existing identical-input four-hour outcome results remain applicable. This archive cannot evaluate these news corrections. No forecast-accuracy gain is claimed.' } };
  const output = path.resolve(arg('output', '.artifacts/asset-news-comparison.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, captured, historical: report.historical }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
