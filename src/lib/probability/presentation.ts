import type { BiasResult } from '../types';

export function displayedProbability(result: BiasResult, at = Date.now()): number | null {
  const p = result.probability;
  const side = result.direction.includes('bullish') ? 'up' : result.direction.includes('bearish') ? 'down' : null;
  return p?.status === 'validated' && p.target === 'macro-direction-close-4h' && p.horizonHours === 4
    && p.validUntil !== null && Number.isFinite(Date.parse(p.validUntil)) && at < Date.parse(p.validUntil)
    && side !== null && p.direction === side && p.value !== null && Number.isFinite(p.value) && p.value >= 0 && p.value <= 1
    ? p.value : null;
}

export function currentProbabilityReading(result: BiasResult, blocked: boolean, now: number): BiasResult {
  if (!result.probability || result.probability.status !== 'validated') return result;
  if (!blocked && displayedProbability(result, now) !== null) return result;
  return { ...result, probability: { ...result.probability, status: 'unavailable', value: null, interval95: null,
    reason: 'This probability is no longer current. Refresh after live inputs recover.' } };
}

export function probabilityText(result: BiasResult): string {
  const value = displayedProbability(result);
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** Qualified probabilities precede unavailable readings; both directions use one scale. */
export function compareProbabilities(a: BiasResult, b: BiasResult): number {
  const ap = displayedProbability(a), bp = displayedProbability(b);
  const tier = (p: number | null) => p === null ? 0 : p >= 0.5 ? 2 : 1;
  return tier(bp) - tier(ap) || (bp ?? 0) - (ap ?? 0) || a.symbol.localeCompare(b.symbol);
}
