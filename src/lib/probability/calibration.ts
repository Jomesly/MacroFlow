import { z } from 'zod';
import { MODEL_VERSION } from '../macro-context';
import { ALL_SYMBOLS } from '../engine';
import { groupAssessment, MAX_MODEL_AGE_MS, TARGET, type ProbabilityModel } from './model';

export const observationSchema = z.object({
  inputModelVersion: z.literal(MODEL_VERSION), inputProfile: z.literal('prospective-live'),
  symbol: z.enum(ALL_SYMBOLS), side: z.enum(['up', 'down']), key: z.string(),
  timestamp: z.iso.datetime(), entryTime: z.iso.datetime(), exitTime: z.iso.datetime(), success: z.boolean(),
});
export type ProbabilityObservation = z.infer<typeof observationSchema>;

/** One chronological split, no threshold search and no validation refitting. */
export function fitProbabilityModel(input: unknown, holdoutStart: string, createdAt: string, dataSha256: string) {
  const parsed = z.array(observationSchema).parse(input);
  const cutoff = Date.parse(holdoutStart), now = Date.parse(createdAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(now) || cutoff >= now) throw new Error('Invalid validation cutoff');
  const seen = new Set<string>(), ends = new Map<string, number>();
  let rejected = 0;
  const records = parsed.slice().sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.symbol.localeCompare(b.symbol)).filter(row => {
    const at = Date.parse(row.timestamp), entry = Date.parse(row.entryTime), exit = Date.parse(row.exitTime);
    const id = `${row.symbol}:${row.timestamp}`;
    if (seen.has(id)) throw new Error('Duplicate prediction timestamps must be resolved before calibration');
    seen.add(id);
    if (!(entry > at && entry - at <= 3_600_000 && exit - entry === 4 * 3_600_000 && exit <= now)) { rejected++; return false; }
    if (entry < (ends.get(row.symbol) ?? 0)) { rejected++; return false; }
    ends.set(row.symbol, exit);
    return true;
  });
  const calibration = records.filter(row => Date.parse(row.timestamp) < cutoff && Date.parse(row.exitTime) < cutoff);
  const holdout = records.filter(row => Date.parse(row.timestamp) >= cutoff);
  const summarize = (rows: ProbabilityObservation[]) => ({ n: rows.length, wins: rows.filter(row => row.success).length,
    days: new Set(rows.map(row => row.entryTime.slice(0,10))).size });
  const groups = [...new Set(calibration.map(row => row.key))].sort().map(key => {
    const members = calibration.filter(row => row.key === key);
    const first = members[0];
    if (members.some(row => row.symbol !== first.symbol || row.side !== first.side)) throw new Error('Mixed assets or directions in a calibration group');
    const later = holdout.filter(row => row.key === key);
    if (later.some(row => row.symbol !== first.symbol || row.side !== first.side)) throw new Error('Validation group identity mismatch');
    return { key, calibration: summarize(members), holdout: summarize(later),
      baseline: summarize(calibration.filter(row => row.symbol === first.symbol && row.side === first.side)) };
  });
  const calibrationEnd = calibration.map(row => row.exitTime).sort().at(-1) ?? new Date(cutoff - 1).toISOString();
  const holdoutEnd = holdout.map(row => row.exitTime).sort().at(-1) ?? holdoutStart;
  const model: ProbabilityModel = { schemaVersion: 1, method: 'empirical-buckets-v1', target: TARGET,
    inputModelVersion: MODEL_VERSION, inputProfile: 'prospective-live', createdAt, dataSha256,
    calibrationEnd, holdoutStart, holdoutEnd, expiresAt: new Date(Date.parse(holdoutEnd) + MAX_MODEL_AGE_MS).toISOString(), groups };
  return { model, report: { input: parsed.length, independent: records.length, rejected, purged: records.length - calibration.length - holdout.length,
    calibration: calibration.length, holdout: holdout.length,
    groups: groups.map(group => ({ key: group.key, ...groupAssessment(group), calibration: group.calibration, holdout: group.holdout })) } };
}
