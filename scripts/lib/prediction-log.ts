import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { MacroContext, MacroEvent, SourceHealth, DataSource } from '../../src/lib/types';

export interface PredictionInputs {
  events: MacroEvent[]; context: MacroContext; cachedAt: string; source: DataSource;
  sourceHealth: SourceHealth; stale?: boolean;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function predictionSlot(timestamp: string): string {
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid prediction timestamp');
  return new Date(timestamp).toISOString().slice(0, 13).replaceAll(':', '-');
}

/** The receipt timestamp is supplied by the collector's clock, never a provider publication date. */
export function captureEligibility(inputs: PredictionInputs, receivedAt: string) {
  const age = Date.parse(receivedAt) - Date.parse(inputs.cachedAt);
  const reasons: string[] = [];
  if (!Number.isFinite(age) || age < 0 || age > 5 * 60_000) reasons.push('Input bundle is not fresh');
  if (inputs.source !== 'live' || inputs.stale || !Object.keys(inputs.sourceHealth).length || Object.values(inputs.sourceHealth).includes('failed')) reasons.push('Live providers incomplete');
  if (inputs.events.some(event => !Number.isFinite(Date.parse(event.timestamp)) || Date.parse(event.timestamp) > Date.parse(receivedAt))) reasons.push('Invalid or future source timestamp');
  if (!Number.isFinite(Date.parse(inputs.context.asOf)) || Date.parse(inputs.context.asOf) > Date.parse(receivedAt)) reasons.push('Invalid or future context');
  if (inputs.events.some(event => event.evidenceType === 'surprise' && (!event.releaseEvidence
    || !Number.isFinite(Date.parse(event.releaseEvidence.consensusFirstSeenAt))
    || !(Date.parse(event.releaseEvidence.consensusFirstSeenAt) < Date.parse(event.releaseEvidence.releasedAt))
    || !(Date.parse(event.releaseEvidence.releasedAt) <= Date.parse(receivedAt))))) reasons.push('Surprise lacks archived pre-release consensus evidence');
  return { eligible: reasons.length === 0, reasons };
}

/** Atomic, create-only publication. An interrupted temp file is never a valid prediction. */
export function writeImmutableJson(file: string, value: unknown): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const body = JSON.stringify(value, null, 2) + '\n';
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temporary, file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  finally { fs.unlinkSync(temporary); }
}
