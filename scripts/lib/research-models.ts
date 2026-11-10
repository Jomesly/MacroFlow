import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scoreMacroAlignment } from '../../src/lib/alignment';
import { RESEARCH_POLICIES } from '../../src/lib/scoring-policy';
import { selectEventsAsOf } from '../../src/lib/macro-context';
import type { BiasResult, MacroContext, MacroEvent } from '../../src/lib/types';

export const REFERENCE_SHA = 'e52443bff3b65df86d7568c40c68175517db11ef';
export const PRODUCTION_SHA = '178457f05e7f45e90353230af0612a6fa144f200';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export type ResearchScorer = (events: MacroEvent[], context: MacroContext, asOf: string) => BiasResult[];

export async function researchModels() {
  const scorers: Record<string, ResearchScorer> = {};
  const provenance: Record<string, unknown> = {};
  for (const [name, revision] of [['reference', REFERENCE_SHA], ['production', PRODUCTION_SHA]]) {
    const dir = path.resolve('.artifacts/research-models', revision);
    fs.mkdirSync(dir, { recursive: true });
    const files = name === 'reference' ? ['engine.ts', 'rules.ts', 'types.ts'] : ['engine.ts', 'rules.ts', 'types.ts', 'alignment.ts', 'macro-context.ts'];
    const hashes: Record<string, string> = {};
    for (const file of files) {
      const source = execFileSync('git', ['show', `${revision}:src/lib/${file}`], { encoding: 'utf8' });
      fs.writeFileSync(path.join(dir, file), source);
      hashes[file] = sha256(source);
    }
    const historicalModule = await import(pathToFileURL(path.join(dir, name === 'reference' ? 'engine.ts' : 'alignment.ts')).href);
    scorers[name] = name === 'reference'
      ? (events, _context, asOf) => historicalModule.calculateBias(selectEventsAsOf(events, asOf)).map((result: BiasResult) => ({ ...result, lastUpdated: asOf }))
      : historicalModule.scoreMacroAlignment;
    provenance[name] = { revision, hashes, spread: name === 'reference' ? 'omitted, as in reference API' : 'context' };
  }
  const hashes = Object.fromEntries(['engine.ts', 'alignment.ts', 'rules.ts', 'types.ts', 'bias-reading.ts', 'macro-context.ts', 'scoring-policy.ts']
    .map(file => [file, sha256(fs.readFileSync(path.join('src/lib', file), 'utf8'))]));
  for (const [name, policy] of Object.entries(RESEARCH_POLICIES)) {
    scorers[name] = (events, context, asOf) => scoreMacroAlignment(events, context, asOf, undefined, policy);
    provenance[name] = { policy, hashes };
  }
  const pipelineFiles = ['src/lib/events.ts', 'src/lib/market-evidence.ts', 'src/lib/backtest.ts', 'src/lib/research-evaluation.ts',
    ...fs.readdirSync('src/lib/api').filter(file => file.endsWith('.ts')).map(file => `src/lib/api/${file}`),
    ...fs.readdirSync('src/lib/calendar').filter(file => file.endsWith('.ts')).map(file => `src/lib/calendar/${file}`),
    'scripts/prediction-research.ts', 'scripts/evaluate-prospective.ts', 'scripts/watch-predictions.ts', 'scripts/lib/prediction-log.ts', 'scripts/lib/research-models.ts', 'package-lock.json'];
  provenance.pipeline = Object.fromEntries(pipelineFiles.map(file => [file, sha256(fs.readFileSync(file, 'utf8'))]));
  return { scorers, provenance };
}
