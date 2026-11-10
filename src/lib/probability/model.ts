import { z } from 'zod';
import { MODEL_VERSION } from '../macro-context';
import type { BiasResult, SourceHealth } from '../types';
import type { ProbabilityEstimate } from './types';

export const TARGET = 'macro-direction-close-4h' as const;
export const MIN_SAMPLES = 100;
export const MIN_DAYS = 30;
export const MAX_CALIBRATION_ERROR = 0.05;
export const MIN_BRIER_IMPROVEMENT = 0.005;
export const MAX_MODEL_AGE_MS = 30 * 86_400_000;

const counts = z.object({ n: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), days: z.number().int().nonnegative() })
  .refine(row => row.wins <= row.n && row.days <= row.n);
export const modelSchema = z.object({
  schemaVersion: z.literal(1), method: z.literal('empirical-buckets-v1'), target: z.literal(TARGET),
  inputModelVersion: z.string(), inputProfile: z.literal('prospective-live'),
  dataSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(),
  calibrationEnd: z.iso.datetime(), holdoutStart: z.iso.datetime(), holdoutEnd: z.iso.datetime(), expiresAt: z.iso.datetime(),
  groups: z.array(z.object({ key: z.string(), calibration: counts, holdout: counts, baseline: counts })),
});
export type ProbabilityModel = z.infer<typeof modelSchema>;
export type CalibrationGroup = ProbabilityModel['groups'][number];

export function macroSide(result: BiasResult): 'up' | 'down' | null {
  return result.direction.includes('bullish') ? 'up' : result.direction.includes('bearish') ? 'down' : null;
}

/** Fixed before fitting. Do not tune these bands on the validation outcomes. */
export function probabilityKey(result: BiasResult): string {
  const magnitude = Math.abs(result.biasScore);
  const band = magnitude < 25 ? '15-24' : magnitude < 50 ? '25-49' : magnitude < 75 ? '50-74' : '75-100';
  const evidence = [...new Set(result.events.map(event => event.evidenceType ?? 'headline'))].sort().join(',');
  return [result.symbol, macroSide(result), result.alignment?.context.regime, band, result.alignment?.marketConfirmation, evidence].join('|');
}

export function wilson(wins: number, n: number): [number, number] {
  const z = 1.96, p = wins / n, denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

const smoothedRate = (counts: { n: number; wins: number }) => (counts.wins + 1) / (counts.n + 2);
const brier = (p: number, n: number, wins: number) => (wins * (1 - p) ** 2 + (n - wins) * p ** 2) / n;

export function groupAssessment(group: CalibrationGroup) {
  const { calibration: c, holdout: h, baseline: b } = group;
  const value = smoothedRate(c);
  const interval95 = c.n ? wilson(c.wins, c.n) : [0, 1] as [number, number];
  const brierScore = h.n ? brier(value, h.n, h.wins) : 1;
  const baselineBrier = h.n ? brier(smoothedRate(b), h.n, h.wins) : 0;
  const error = h.n ? Math.abs(value - h.wins / h.n) : 1;
  const reasons: string[] = [];
  if (c.n < MIN_SAMPLES || h.n < MIN_SAMPLES || b.n < c.n || b.wins < c.wins || b.n - b.wins < c.n - c.wins) reasons.push('Too few independent calibration or validation outcomes.');
  if (c.days < MIN_DAYS || h.days < MIN_DAYS) reasons.push('Too few distinct calibration or validation days.');
  if (interval95[1] - interval95[0] > 0.2) reasons.push('Probability uncertainty is too wide.');
  if (error > MAX_CALIBRATION_ERROR) reasons.push('Estimated probability did not match later outcomes closely enough.');
  if (baselineBrier - brierScore < MIN_BRIER_IMPROVEMENT) reasons.push('Probability did not improve on the historical base rate.');
  return { value, interval95, brierScore, baselineBrier, error, reasons };
}

export function probabilityInputIssue(result: BiasResult): string | null {
  if (!macroSide(result)) return 'No directional macro reading is available.';
  if (!Number.isFinite(result.biasScore) || Math.abs(result.biasScore) > 100) return 'The macro reading is invalid.';
  if (result.alignment?.modelVersion !== MODEL_VERSION) return 'This macro version has no compatible probability model.';
  if (!result.alignment.context.complete || result.alignment.context.regime === 'unknown') return 'Fresh macro context is incomplete.';
  if (!result.events.some(e => e.evidenceType === 'trend' || e.evidenceType === 'surprise')) return 'Structured economic evidence is unavailable.';
  if (!result.alignment.marketConfirmation || result.alignment.marketConfirmation === 'missing') return 'Fresh market observations are unavailable.';
  return null;
}

/** Fail closed. Neither a large rule score nor a missing model implies 50%. */
export function estimateProbability(result: BiasResult, artifact: unknown, now: string, health: { source: string; stale?: boolean; sourceHealth: SourceHealth }): ProbabilityEstimate {
  const unavailable = (reason: string): ProbabilityEstimate => ({ status: 'unavailable', target: TARGET, horizonHours: 4,
    direction: macroSide(result), value: null, interval95: null, calibrationSamples: 0, validationSamples: 0, modelId: null, validUntil: null, reason });
  if (health.source !== 'live' || health.stale || Object.values(health.sourceHealth).includes('failed')) return unavailable('Live inputs are incomplete or stale.');
  const age = Date.parse(now) - Date.parse(result.lastUpdated);
  if (!Number.isFinite(age) || age < 0 || age > 5 * 60_000) return unavailable('The macro reading is stale or invalid.');
  const issue = probabilityInputIssue(result);
  if (issue) return unavailable(issue);
  const parsed = modelSchema.safeParse(artifact);
  if (!parsed.success) return unavailable('Not enough independently validated history for a probability yet.');
  const model = parsed.data;
  const [created, end, start, finish, expires, at] = [model.createdAt, model.calibrationEnd, model.holdoutStart, model.holdoutEnd, model.expiresAt, now].map(Date.parse);
  if (model.inputModelVersion !== MODEL_VERSION || !(end < start && start < finish && finish <= created && created <= at && at < expires && expires > created && expires - finish <= MAX_MODEL_AGE_MS)) return unavailable('The probability model is expired or incompatible with this reading.');
  const groups = model.groups.filter(group => group.key === probabilityKey(result));
  if (groups.length !== 1) return unavailable('This market and macro condition do not have enough validated history.');
  const group = groups[0], assessed = groupAssessment(group);
  if (assessed.reasons.length) return unavailable(assessed.reasons.join(' '));
  return { status: 'validated', target: TARGET, horizonHours: 4, direction: macroSide(result), value: assessed.value,
    interval95: assessed.interval95, calibrationSamples: group.calibration.n, validationSamples: group.holdout.n,
    modelId: model.dataSha256, validUntil: new Date(Math.min(Date.parse(result.lastUpdated) + 5 * 60_000, expires)).toISOString(),
    reason: 'Estimated from comparable macro readings and checked on later, separate outcomes.' };
}
