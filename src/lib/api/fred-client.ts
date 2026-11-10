import { FRED_SERIES, type FredObservation, type FredSnapshot, vintageAvailableAt } from '../macro-context';

export async function fetchFredSnapshot(vintageDate: string, apiKey: string): Promise<FredSnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vintageDate)) throw new Error('Invalid FRED vintage date');
  const snapshot: FredSnapshot = { schemaVersion: 1, vintageDate, availableAt: vintageAvailableAt(vintageDate), series: {}, failedSeries: [] };
  await Promise.all(FRED_SERIES.map(async (id) => {
    try {
      const url = new URL('https://api.stlouisfed.org/fred/series/observations');
      for (const [key, value] of Object.entries({ series_id: id, api_key: apiKey, file_type: 'json',
        realtime_start: vintageDate, realtime_end: vintageDate, observation_end: vintageDate,
        sort_order: 'desc', limit: '16', units: 'lin' })) url.searchParams.set(key, value);
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
      if (!response.ok) throw new Error(`FRED HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.observations)) throw new Error('Invalid observations');
      snapshot.series[id] = data.observations.filter((o: FredObservation) => typeof o.date === 'string' && typeof o.value === 'string')
        .map((o: FredObservation) => ({ date: o.date, value: o.value }));
    } catch {
      // Do not log request URLs: they contain API credentials.
      snapshot.failedSeries.push(id);
    }
  }));
  snapshot.failedSeries.sort();
  return snapshot;
}
