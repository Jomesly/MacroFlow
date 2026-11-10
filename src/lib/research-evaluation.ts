import { directionSign, wilsonInterval, type EvaluationRecord } from './backtest';
import type { BiasResult } from './types';

export interface ResearchRow { result: BiasResult; outcome: EvaluationRecord }

/** All models share a price-only, nonoverlapping schedule selected before inspecting signals. */
export function researchSummary(rows: ResearchRow[], scheduled: number, priceEligible: number, qualifiedOnly = false) {
  const active = rows.filter(row => directionSign(row.result.direction) !== 0 && (!qualifiedOnly
    || (row.result.alignment?.status === 'aligned' && row.result.conviction === 'high')));
  const valid = active.filter(row => !row.outcome.rejection && row.outcome.grossReturn !== null);
  const wins = valid.filter(row => row.outcome.grossReturn! > 0).length;
  const ties = valid.filter(row => row.outcome.grossReturn === 0).length;
  const n = valid.length;
  const mean = (fn: (row: ResearchRow) => number) => n ? valid.reduce((sum, row) => sum + fn(row), 0) / n : null;
  return { scheduled, priceEligible, commonNonoverlappingWindows: rows.length, priceCoverage: scheduled ? priceEligible / scheduled : null,
    activeOnCommonWindows: active.length, n, days: new Set(valid.map(row => row.outcome.entryTime!.slice(0, 10))).size,
    wins, ties, directionalAccuracy: n ? wins / n : null, wilson95: wilsonInterval(wins, n),
    alwaysLongAccuracy: mean(row => Number(row.outcome.grossReturn! * directionSign(row.result.direction) > 0)),
    meanNetBps: mean(row => row.outcome.netReturn! * 10_000),
    alwaysLongNetBps: mean(row => row.outcome.longNetReturn! * 10_000),
    alwaysShortNetBps: mean(row => row.outcome.shortNetReturn! * 10_000),
  };
}

/** Paired daily-cluster bootstrap; descriptive, not an untouched-holdout significance test. */
export function pairedDirectionDifference(candidate: ResearchRow[], baseline: ResearchRow[], alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Invalid interval alpha');
  const other = new Map(baseline.map(row => [row.outcome.timestamp, row]));
  const days = new Map<string, number[]>();
  for (const row of candidate) {
    const base = other.get(row.outcome.timestamp);
    if (!base || row.outcome.grossReturn === null || base.outcome.grossReturn === null || row.outcome.rejection || base.outcome.rejection) continue;
    const day = row.outcome.entryTime!.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), Number(row.outcome.grossReturn > 0) - Number(base.outcome.grossReturn > 0)]);
  }
  const groups = [...days.values()];
  const values = groups.flat();
  if (!values.length) return { n: 0, days: 0, difference: null, intervalLevel: 1 - alpha, dailyBootstrapInterval: null };
  let seed = 20261110;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const draws = Array.from({ length: 2000 }, () => {
    let sum = 0, n = 0;
    for (let i = 0; i < groups.length; i++) { const group = groups[Math.floor(random() * groups.length)]; sum += group.reduce((a, b) => a + b, 0); n += group.length; }
    return sum / n;
  }).sort((a, b) => a - b);
  return { n: values.length, days: groups.length, difference: values.reduce((a, b) => a + b, 0) / values.length,
    intervalLevel: 1 - alpha, dailyBootstrapInterval: groups.length >= 2 ? [draws[Math.floor(draws.length * alpha / 2)], draws[Math.ceil(draws.length * (1 - alpha / 2)) - 1]] : null };
}
