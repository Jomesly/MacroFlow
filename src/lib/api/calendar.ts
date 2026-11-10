import { classifyEconomicEvent } from './classifier';
import type { MacroEvent } from '../types';

export interface EconomicRelease {
  event: string; country: string; time: string; actual: number | null; estimate: number | null; impact: string;
}

export function releaseToEvent(release: EconomicRelease, asOf: string, sourceName = 'Finnhub calendar'): MacroEvent | null {
  const country = release.country.toUpperCase();
  if (!['US', 'GB', 'UK'].includes(country)) return null;
  const time = release.time.replace(' ', 'T');
  const timestamp = /Z$|[+-]\d\d:\d\d$/.test(time) ? time : `${time}Z`;
  if (!Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) > Date.parse(asOf)) return null;
  const name = /interest rate decision/i.test(release.event)
    ? `${country === 'US' ? 'Fed' : 'BoE'} ${release.event}` : release.event;
  const classified = classifyEconomicEvent(name, release.actual, release.estimate);
  if (!classified) return null;
  const releaseCountry = country === 'UK' ? 'GB' : country;
  return {
    id: `release:${releaseCountry}:${release.event}:${timestamp}`, seriesId: `release:${releaseCountry}:${release.event}`,
    ...classified, title: `${releaseCountry} ${release.event}`, country: releaseCountry,
    description: `Actual ${release.actual}; consensus ${release.estimate}.`, timestamp: new Date(timestamp).toISOString(),
    expiresAt: new Date(Date.parse(timestamp) + 86_400_000).toISOString(),
    impact: release.impact === 'high' ? 'high' : release.impact === 'medium' ? 'medium' : 'low',
    sourceName, evidenceType: 'surprise',
  };
}
