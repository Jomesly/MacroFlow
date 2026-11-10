import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ALL_SYMBOLS } from '../src/lib/engine';
import { MODEL_VERSION } from '../src/lib/macro-context';
import { evaluateFourHours } from '../src/lib/backtest';
import { fitProbabilityModel, type ProbabilityObservation } from '../src/lib/probability/calibration';
import { macroSide, probabilityInputIssue, probabilityKey } from '../src/lib/probability/model';
import type { BiasResult } from '../src/lib/types';
import type { PriceDataset } from '../src/lib/market-evidence';

const arg = (name: string, fallback?: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const command = process.argv[2];
const root = path.resolve(arg('out', 'data/probability')!);
const responseSchema = z.object({ source: z.literal('live'), stale: z.boolean().optional(), timestamp: z.iso.datetime(),
  sourceHealth: z.record(z.string(), z.enum(['ok','empty','failed'])),
  data: z.array(z.object({ symbol: z.enum(ALL_SYMBOLS), biasScore: z.number().min(-100).max(100), lastUpdated: z.iso.datetime(),
    direction: z.enum(['bullish','bearish','weakly_bullish','weakly_bearish','neutral']), conviction: z.enum(['high','medium','low']),
    events: z.array(z.object({ evidenceType: z.enum(['headline','trend','surprise','market']).optional() }).passthrough()),
    alignment: z.object({ modelVersion: z.literal(MODEL_VERSION), marketConfirmation: z.enum(['confirming','opposing','flat','missing']),
      status: z.enum(['aligned','conflicted','unconfirmed','insufficient_evidence']),
      context: z.object({ complete: z.boolean(), regime: z.enum(['rates_sensitive','growth_sensitive','mixed','unknown']) }).passthrough() }).passthrough(),
  }).passthrough()),
}).passthrough();
const captureSchema = z.object({ schemaVersion: z.literal(1), inputProfile: z.literal('prospective-live'), receivedAt: z.iso.datetime(), response: responseSchema });

function usableResponse(response: z.infer<typeof responseSchema>, receivedAt: string) {
  const age = Date.parse(receivedAt) - Date.parse(response.timestamp);
  return !response.stale && !Object.values(response.sourceHealth).includes('failed') && age >= 0 && age <= 5 * 60_000;
}

async function main() {
  if (command === 'capture') {
    const rawUrl = arg('url');
    if (!rawUrl) throw new Error('Supply --url=https://your-deployment; capture only the reviewed model version.');
    const url = new URL('/api/bias', rawUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Bias endpoint returned HTTP ${response.status}`);
    const body = responseSchema.parse(await response.json());
    const receivedAt = new Date().toISOString();
    if (!usableResponse(body, receivedAt)) throw new Error('Refusing to archive stale or failed-provider inputs for calibration.');
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, `${receivedAt.slice(0,13).replaceAll(':','-')}.json`);
    // Receipt time is assigned here, never supplied via CLI or backdated.
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, inputProfile: 'prospective-live', receivedAt, response: body }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ file, capturedAt: receivedAt, assets: body.data.length }));
    return;
  }
  if (command === 'fit') {
    const capturesDir = arg('captures'), pricesDir = arg('prices'), cutoff = arg('holdout-start');
    if (!capturesDir || !pricesDir || !cutoff) throw new Error('Supply --captures=directory --prices=directory --holdout-start=ISO-date-time.');
    const records: ProbabilityObservation[] = [], rejections: Record<string, number> = {};
    const hash = createHash('sha256'), prices = new Map<string, PriceDataset | null>();
    const reject = (reason: string) => { rejections[reason] = (rejections[reason] ?? 0) + 1; };
    for (const symbol of ALL_SYMBOLS) {
      const file = path.join(pricesDir, `${symbol}.json`);
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      hash.update(symbol + '\n' + raw + '\n');
      prices.set(symbol, raw ? JSON.parse(raw) : null);
    }
    for (const file of fs.readdirSync(capturesDir).filter(file => file.endsWith('.json')).sort()) {
      const raw = fs.readFileSync(path.join(capturesDir, file), 'utf8');
      hash.update(file + '\n' + raw + '\n');
      const capture = captureSchema.parse(JSON.parse(raw));
      if (!usableResponse(capture.response, capture.receivedAt)) { reject('Stale or degraded capture'); continue; }
      for (const entry of capture.response.data) {
        // The capture retains the full API DTO; the schema above checks every
        // field consumed by probability keys and the four-hour price evaluator.
        const result = entry as unknown as BiasResult;
        const age = Date.parse(capture.receivedAt) - Date.parse(result.lastUpdated);
        if (!(age >= 0 && age <= 60_000)) { reject('Prediction not recorded promptly'); continue; }
        const issue = probabilityInputIssue(result), side = macroSide(result);
        if (issue || !side) { reject(issue ?? 'No direction'); continue; }
        const priceData = prices.get(result.symbol) ?? null;
        if (priceData?.intervalMinutes !== 60) { reject('Hourly prices required for the probability target'); continue; }
        // The capture receipt time is the prediction time. Entry must follow it.
        const evaluated = evaluateFourHours({ schemaVersion: 1, modelVersion: MODEL_VERSION,
          timestamp: capture.receivedAt, inputProfile: 'full-archive', result }, priceData, 0);
        if (evaluated.rejection || evaluated.grossReturn === null || !evaluated.entryTime || !evaluated.exitTime) { reject(evaluated.rejection ?? 'No outcome'); continue; }
        records.push({ inputModelVersion: MODEL_VERSION, inputProfile: 'prospective-live', symbol: result.symbol,
          side, key: probabilityKey(result), timestamp: capture.receivedAt,
          entryTime: evaluated.entryTime, exitTime: evaluated.exitTime, success: evaluated.grossReturn > 0 });
      }
    }
    const result = fitProbabilityModel(records, cutoff, new Date().toISOString(), hash.digest('hex'));
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'candidate.json'), JSON.stringify(result.model, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({ ...result.report, rejections }, null, 2) + '\n');
    console.log(JSON.stringify({ ...result.report, rejections, note: 'Candidate only; registry is unchanged. Review independent outcomes before promotion.' }));
    return;
  }
  if (command === 'audit') {
    const file = arg('evaluation');
    if (!file) throw new Error('Supply --evaluation=path/to/evaluation.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify({ inputProfile: data.inputProfile, modelVersion: data.modelVersion,
      rows: data.records?.length ?? 0, completeLiveArchive: data.completeLiveArchive === true,
      eligibleForProbability: false,
      reason: 'Legacy replay is diagnostic. This model requires prospectively recorded current-version predictions and a separate later validation period.' }, null, 2));
    return;
  }
  throw new Error('Usage: tsx scripts/probability-workflow.ts capture|fit|audit [--name=value]');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Probability workflow failed'); process.exitCode = 1; });
