import { completedVintageDate, vintageAvailableAt, type FredObservation } from '../macro-context';
import { buildDomesticInputs, DOMESTIC_COUNTRIES, DOMESTIC_SERIES, unavailableDomesticHealth,
  type DomesticCountry, type DomesticSnapshot } from '../international-macro';
import { coalesce, getCached, setCache } from './cache';
import type { MacroEvent, SourceHealth } from '../types';

export async function fetchDomesticSnapshot(country: DomesticCountry, vintageDate: string, apiKey: string): Promise<DomesticSnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vintageDate)) throw new Error('Invalid FRED vintage date');
  const snapshot: DomesticSnapshot = { schemaVersion: 1, country, vintageDate,
    availableAt: vintageAvailableAt(vintageDate), fetchedAt: new Date().toISOString(), series: {}, failedSeries: [] };
  await Promise.all(DOMESTIC_SERIES[country].map(async spec => {
    try {
      const url = new URL('https://api.stlouisfed.org/fred/series/observations');
      for (const [key, value] of Object.entries({ series_id: spec.id, api_key: apiKey, file_type: 'json',
        realtime_start: vintageDate, realtime_end: vintageDate, observation_end: vintageDate,
        sort_order: 'desc', limit: '20', units: 'lin' })) url.searchParams.set(key, value);
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
      if (!response.ok) throw new Error('Domestic series unavailable');
      const data = await response.json();
      if (!Array.isArray(data.observations)) throw new Error('Invalid domestic observations');
      snapshot.series[spec.id] = data.observations.filter((row: FredObservation) => typeof row.date === 'string' && typeof row.value === 'string')
        .map((row: FredObservation) => ({ date: row.date, value: row.value }));
    } catch {
      // Never log request URLs or provider responses: API credentials are in the URL.
      snapshot.failedSeries.push(spec.id);
    }
  }));
  snapshot.failedSeries.sort();
  return snapshot;
}

export async function fetchDomesticInputs(asOf = new Date().toISOString()): Promise<{ events: MacroEvent[]; sourceHealth: SourceHealth }> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return { events: [], sourceHealth: unavailableDomesticHealth() };
  const vintageDate = completedVintageDate(asOf);
  const results = await Promise.all(DOMESTIC_COUNTRIES.map(country => coalesce(`domestic_fred_v1:${country}:${vintageDate}`, async () => {
    const key = `domestic_fred_v1:${country}:${vintageDate}`;
    try {
      let snapshot = await getCached<DomesticSnapshot>(key);
      if (!snapshot) {
        snapshot = await fetchDomesticSnapshot(country, vintageDate, apiKey);
        await setCache(key, snapshot, snapshot.failedSeries.length ? 60_000 : 6 * 3_600_000);
      }
      return { country, ...buildDomesticInputs(snapshot, country, asOf) };
    } catch { return { country, events: [] as MacroEvent[], status: 'failed' as const }; }
  })));
  return { events: results.flatMap(result => result.events),
    sourceHealth: Object.fromEntries(results.map(result => [`domestic_${result.country}`, result.status])) };
}
