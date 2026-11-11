import type { BiasResult } from './types';

export interface DirectionChance {
  status: 'estimated' | 'unavailable';
  target: 'price-direction-4h';
  modelVersion: 'heuristic-logit-v1';
  calibration: 'unvalidated';
  horizonHours: 4;
  issuedAt: string;
  expiresAt: string;
  upPercent: number | null;
  downPercent: number | null;
  reason: string;
}

type Components = NonNullable<NonNullable<BiasResult['forecast']>['components']>;

export function unavailableDirectionChance(issuedAt: string, reason: string): DirectionChance {
  return { status: 'unavailable', target: 'price-direction-4h', modelVersion: 'heuristic-logit-v1', calibration: 'unvalidated',
    horizonHours: 4, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 4 * 3_600_000).toISOString(),
    upPercent: null, downPercent: null, reason };
}

/**
 * Explicit, uncalibrated probability model, not score-as-percent.
 * A symmetric logistic link maps bounded directional evidence to odds. The
 * strongest fully observed evidence implies at most 4:1 odds (80%/20%).
 * Missing price data shrinks log odds toward an even split. These are design
 * assumptions pending prospective calibration, not an observed hit rate.
 */
export function estimateDirectionChance(components: Components, sourceCount: number, issuedAt: string): DirectionChance {
  const available = Object.values(components).filter(component => component !== null);
  if (!available.length || available.some(component => !Number.isFinite(component.score) || Math.abs(component.score) > 100
    || !Number.isFinite(component.weight) || component.weight <= 0 || component.weight > 1)
    || Math.abs(available.reduce((sum, component) => sum + component.weight, 0) - 1) > 1e-6) {
    return unavailableDirectionChance(issuedAt, 'No usable directional inputs.');
  }
  const evidence = available.reduce((sum, component) => sum + component.score * component.weight, 0) / 100;
  const coverage = components.momentum ? 1 : components.news ? (sourceCount >= 2 ? 0.7 : 0.5) : 0.35;
  const upTenths = Math.round(1000 / (1 + Math.exp(-Math.log(4) * evidence * coverage)));
  return { ...unavailableDirectionChance(issuedAt, 'Model-estimated direction chance; not calibrated against realized outcomes.'),
    status: 'estimated', upPercent: upTenths / 10, downPercent: (1000 - upTenths) / 10 };
}

/** Prevent stale, malformed, legacy, or blocked payloads being displayed as current chances. */
export function currentDirectionChance(result: BiasResult, now: number, blocked = false): DirectionChance | null {
  const chance = result.forecast?.directionChance;
  if (blocked || !chance || chance.status !== 'estimated' || chance.calibration !== 'unvalidated'
    || chance.target !== 'price-direction-4h' || chance.horizonHours !== 4 || chance.modelVersion !== 'heuristic-logit-v1') return null;
  const issued = Date.parse(chance.issuedAt), expires = Date.parse(chance.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(issued) || !Number.isFinite(expires)
    || issued > now || now >= expires || expires - issued !== 4 * 3_600_000
    || chance.upPercent === null || chance.downPercent === null
    || !Number.isFinite(chance.upPercent) || !Number.isFinite(chance.downPercent)
    || chance.upPercent < 0 || chance.upPercent > 100 || chance.downPercent < 0 || chance.downPercent > 100
    || Math.abs(chance.upPercent + chance.downPercent - 100) > 1e-6) return null;
  return chance;
}

export function chanceHeadline(chance: DirectionChance | null): { percent: number | null; direction: 'up' | 'down' | 'balanced' | 'unavailable' } {
  if (!chance || chance.upPercent === null || chance.downPercent === null) return { percent: null, direction: 'unavailable' };
  return { percent: Math.max(chance.upPercent, chance.downPercent), direction: chance.upPercent === chance.downPercent ? 'balanced'
    : chance.upPercent > chance.downPercent ? 'up' : 'down' };
}
