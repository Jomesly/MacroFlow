/** Prospective shadow collection. Does not alter dashboard scoring or send orders. */
import fs from 'node:fs';
import path from 'node:path';
import { researchModels, readJson } from './lib/research-models';
import { captureEligibility, digest, predictionSlot, writeImmutableJson } from './lib/prediction-log';
import { loadLocalEnvironment } from './lib/environment';
import { getEvents } from '../src/lib/events';
import { selectEventsAsOf } from '../src/lib/macro-context';

const arg = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
export const protocol = {
  id: 'macro-restoration-prospective-v1',
  startsAt: '2026-11-11T00:00:00.000Z', endsAt: '2027-02-09T00:00:00.000Z',
  frequency: 'First capture per UTC hour; receipt time is prediction time; do not backfill missed hours.',
  horizonHours: 4, costBps: 5, minimumNonoverlappingPairsPerAsset: 100, minimumObservedDaysPerAsset: 30,
  primary: 'Restoration versus currentRepair on healthy modern inputs, paired four-hour direction. Report abstentions, coverage and the always-long baseline. Reference comparison restricted to mutually supported inputs.',
  decision: 'One final evaluation after end, no outcome peeking or tuning. Require positive paired improvement with day-block uncertainty, adjusted across the five original assets (99% individual intervals), adequate coverage and sample criteria; otherwise inconclusive. This is a screening criterion, not proof of tradable profitability.',
  excludedFromHoldout: 'All data through 2026-11-10, tests, fixtures, failed/stale captures, model-hash changes, missing or non-executable price windows. Log exclusions and gaps.',
};
async function main() {
  loadLocalEnvironment();
  const dir = path.resolve(arg('out', 'data/prediction-research'));
  const { scorers, provenance } = await researchModels();
  const modelHash = digest(provenance);
  const manifestFile = path.join(dir, 'manifest.json');
  if (process.argv[2] === 'init') {
    if (Date.now() >= Date.parse(protocol.startsAt)) throw new Error('Protocol must be frozen before the fresh period starts; create a new future protocol.');
    const written = writeImmutableJson(manifestFile, { schemaVersion: 1, registeredAt: new Date().toISOString(), protocol, modelHash, provenance });
    console.log(JSON.stringify({ manifestFile, written, modelHash })); return;
  }
  if (process.argv[2] !== 'capture') throw new Error('Use init or capture');
  const manifest = readJson<{ modelHash: string; protocol: typeof protocol }>(manifestFile);
  if (manifest.modelHash !== modelHash || digest(manifest.protocol) !== digest(protocol)) throw new Error('Frozen model/protocol changed; start a separately registered experiment before collecting its outcomes.');
  const startedAt = new Date().toISOString();
  const existingSlotFile = path.join(dir, 'captures', `${predictionSlot(startedAt)}.json`);
  if (fs.existsSync(existingSlotFile)) { console.log(JSON.stringify({ file: existingSlotFile, written: false, reason: 'Hourly slot already recorded' })); return; }
  // One input acquisition; every model consumes this same immutable bundle.
  const inputs = await getEvents();
  const receivedAt = new Date().toISOString();
  const eligibility = captureEligibility(inputs, receivedAt);
  const selected = selectEventsAsOf(inputs.events, receivedAt);
  const outputs = Object.fromEntries(['shared-compatible', 'modern-inputs'].map(profile => {
    const events = profile === 'shared-compatible' ? selected.filter(event => event.evidenceType !== 'trend') : selected;
    return [profile, Object.fromEntries(Object.entries(scorers).filter(([name]) => profile === 'shared-compatible' || name !== 'reference')
      .map(([name, scorer]) => [name, scorer(events, inputs.context, receivedAt)]))];
  }));
  const scoredAt = new Date().toISOString();
  // Prediction time is no earlier than completion, so slow acquisition/scoring cannot backdate a call.
  const predictionAt = scoredAt;
  // Fetching can cross an hour boundary: assign the slot from completion, not request start.
  const file = path.join(dir, 'captures', `${predictionSlot(predictionAt)}.json`);
  const holdout = predictionAt >= protocol.startsAt && predictionAt < protocol.endsAt && eligibility.eligible;
  const payload = { schemaVersion: 1, modelHash, startedAt, receivedAt, predictionAt, holdout, eligibility, inputs, inputsHash: digest(inputs), outputs,
    limitation: 'Exact scorer inputs, including classified source text and release evidence. Not a complete raw wire-news archive; unclassified provider articles are unavailable.' };
  const written = writeImmutableJson(file, { ...payload, payloadHash: digest(payload) });
  console.log(JSON.stringify({ file, written, predictionAt, holdout, eligibility, events: inputs.events.length }));
}
main().catch(() => { console.error('Research collection failed; check configuration, manifest and provider availability. No credentials or provider URLs logged.'); process.exitCode = 1; });
