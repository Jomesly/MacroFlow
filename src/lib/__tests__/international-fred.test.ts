import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDomesticInputs, fetchDomesticSnapshot } from '../api/international-fred';
import { DOMESTIC_SERIES } from '../international-macro';

vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => null),
  coalesce: vi.fn(async (_key: string, load: () => Promise<unknown>) => load()) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('international FRED point-in-time requests', () => {
  it('pins every request to the completed vintage and preserves explicit provider failures', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      urls.push(url);
      return url.searchParams.get('series_id') === 'NAEXKP01GBQ657S'
        ? Response.json({ observations: [{ date: '2026-07-01', value: '0.4' }] }) : new Response('', { status: 503 });
    }));
    const snapshot = await fetchDomesticSnapshot('GB', '2026-11-23', 'test-key');
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.searchParams.get('realtime_start')).toBe('2026-11-23');
      expect(url.searchParams.get('realtime_end')).toBe('2026-11-23');
      expect(url.searchParams.get('observation_end')).toBe('2026-11-23');
      expect(url.searchParams.get('units')).toBe('lin');
    }
    expect(snapshot.availableAt).toBe('2026-11-24T00:00:00.000Z');
    expect(snapshot.failedSeries).toEqual(['LRHUTTTTGBM156S']);
  });

  it('does not contact a provider without its key and reports every required country unavailable', async () => {
    vi.stubEnv('FRED_API_KEY', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await fetchDomesticInputs('2026-11-24T10:00:00.000Z');
    expect(fetcher).not.toHaveBeenCalled();
    expect(Object.keys(result.sourceHealth)).toHaveLength(7);
    expect(Object.values(result.sourceHealth).every(status => status === 'failed')).toBe(true);
  });

  it('keeps an individual country failure from dropping the other countries', async () => {
    vi.stubEnv('FRED_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      const id = url.searchParams.get('series_id');
      if (id === 'NAEXKP01GBQ657S') throw new Error('offline');
      const spec = Object.values(DOMESTIC_SERIES).flat().find(series => series.id === id)!;
      return Response.json({ observations: Array.from({ length: 20 }, (_, i) => ({
        date: new Date(Date.UTC(2026, (spec.frequency === 'quarterly' ? 6 : 9) - i * (spec.frequency === 'quarterly' ? 3 : 1), 1)).toISOString().slice(0, 10),
        value: String(spec.transform === 'gdp_growth' ? 0.4 : spec.transform === 'unemployment' ? 4 + i * 0.1 : 110 - i * 0.4 - i * i * 0.01),
      })) });
    }));
    const result = await fetchDomesticInputs('2026-11-24T10:00:00.000Z');
    expect(result.sourceHealth.domestic_GB).toBe('failed');
    expect(result.sourceHealth.domestic_JP).toBe('ok');
    expect(result.events.some(event => event.country === 'JP')).toBe(true);
  });
});
