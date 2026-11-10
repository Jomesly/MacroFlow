import { buildMarketEvents } from '../market-evidence';
export { classifyDxyMove, classifyYieldMove } from '../market-evidence';
import type { MacroEvent } from '../types';
import { getCached, setCache } from './cache';
import { fetchYahooHourly } from './intraday';

export async function fetchMarketData(): Promise<MacroEvent[]> {
  const cached = await getCached<MacroEvent[]>('market_hourly_v3');
  if (cached) return cached;
  const results = await Promise.allSettled([
    fetchYahooHourly('DXY', 'DX-Y.NYB', '5d'),
    fetchYahooHourly('US10Y', '^TNX', '5d'),
  ]);
  if (results.every(result => result.status === 'rejected')) throw new Error('Hourly market confirmation unavailable');
  const events = buildMarketEvents({
    DXY: results[0].status === 'fulfilled' ? results[0].value : undefined,
    US10Y: results[1].status === 'fulfilled' ? results[1].value : undefined,
  }, new Date().toISOString());
  await setCache('market_hourly_v3', events, 120_000);
  return events;
}
