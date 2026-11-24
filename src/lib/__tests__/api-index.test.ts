import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/cache', () => ({
  getCached: vi.fn(async () => null),
  getCacheEntry: vi.fn(async () => null),
  coalesce: vi.fn(async (_key: string, load: () => Promise<unknown>) => load()),
  setCache: vi.fn(async () => undefined),
}));

vi.mock('../api/finnhub', () => ({
  fetchNews: vi.fn(async () => []),
  getFinnhubNewsHealth: vi.fn(async () => ({})),
}));

vi.mock('../api/twelvedata', () => ({
  fetchMarketData: vi.fn(async () => [{
    id: 'dxy',
    category: 'dollar_strength',
    title: 'DXY strong',
    description: 'DXY strong',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'strong',
    sourceName: 'yahoo',
  }]),
}));

vi.mock('../api/rss', () => ({
  fetchRssFeeds: vi.fn(async () => []),
  getRssFeedHealth: vi.fn(async () => ({})),
}));

vi.mock('../api/fred', async () => ({
  fetchFredInputs: vi.fn(async () => ({ events: [], context: (await import('../macro-context')).unknownContext(new Date().toISOString()), failed: false })),
}));

vi.mock('../api/international-fred', () => ({
  fetchDomesticInputs: vi.fn(async () => ({ events: [], sourceHealth: { domestic_GB: 'empty' as const } })),
}));

vi.mock('../calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../calendar')>()),
  getCalendar: vi.fn(async () => ({ events: [], surprises: [], fetchedAt: new Date().toISOString(), archiveStatus: 'ok' as const })),
}));

describe('fetchAllEvents source health', () => {
  it('preserves domestic provenance and country health through the provider merge and cached schema', async () => {
    const { fetchDomesticInputs } = await import('../api/international-fred');
    const { fetchAllEvents } = await import('../api');
    vi.mocked(fetchDomesticInputs).mockResolvedValueOnce({ events: [{ id: 'uk-gdp', category: 'gdp', value: 'expanding',
      country: 'GB', seriesId: 'NAEXKP01GBQ657S', title: 'UK GDP', description: 'Historical trend',
      timestamp: new Date().toISOString(), impact: 'high', evidenceType: 'trend',
      trendEvidence: { provider: 'FRED/ALFRED', seriesId: 'NAEXKP01GBQ657S', units: 'percent', frequency: 'quarterly',
        vintageDate: '2026-11-23', availableAt: '2026-11-24T00:00:00.000Z', fetchedAt: '2026-11-24T10:00:00.000Z',
        observationEnd: '2026-09-30T23:59:59.999Z', currentValue: 0.4, comparisonValue: 0.2,
        derivedValue: 0.4, derivedUnits: 'percent change from previous quarter', transform: 'gdp_growth' } }],
      sourceHealth: { domestic_GB: 'ok' } });
    const result = await fetchAllEvents();
    expect(result.sourceHealth.domestic_GB).toBe('ok');
    expect(result.events.find(event => event.id === 'uk-gdp')?.trendEvidence?.vintageDate).toBe('2026-11-23');
    const { getCacheEntry } = await import('../api/cache');
    vi.mocked(getCacheEntry).mockResolvedValueOnce({ data: result, fetchedAt: Date.now(), freshUntil: Date.now() + 1000, staleUntil: Date.now() + 2000 });
    expect((await fetchAllEvents()).events.find(event => event.id === 'uk-gdp')?.trendEvidence).toEqual(result.events[0].trendEvidence);
  });
  it('preserves a failed Finnhub desk even when another desk returned stories', async () => {
    const { fetchNews, getFinnhubNewsHealth } = await import('../api/finnhub');
    vi.mocked(fetchNews).mockResolvedValueOnce([{ id: 'desk-story', category: 'fed_tone', title: 'Fed hikes rates',
      description: 'Fed hikes rates', timestamp: new Date().toISOString(), impact: 'high', value: 'hawkish', sourceName: 'Publisher' }]);
    vi.mocked(getFinnhubNewsHealth).mockResolvedValueOnce({ feed_finnhub_general: 'ok', feed_finnhub_forex: 'failed', feed_finnhub_crypto: 'ok' });
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();
    expect(result.sourceHealth.feed_finnhub_forex).toBe('failed');
    expect(result.sourceHealth.finnhub).toBe('ok');
    expect(result.sourceHealth.market_data).toBe('ok');
  });
  it('reports ok and empty sources', async () => {
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();

    expect(result.sourceHealth.finnhub).toBe('empty');
    expect(result.sourceHealth.market_data).toBe('ok');
    expect(result.sourceHealth.rss).toBe('empty');
    expect(result.sourceHealth.fred).toBe('empty');
    expect(result.sourceHealth.calendar_archive).toBe('ok');
    expect(result.sourceHealth.economic_calendar).toBe('empty');
    expect(result.events).toHaveLength(1);
  });

  it('keeps the other sources when the economic calendar fails', async () => {
    const { getCalendar } = await import('../calendar');
    vi.mocked(getCalendar).mockRejectedValueOnce(new Error('Calendar feed HTTP 429'));
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();

    expect(result.sourceHealth.economic_calendar).toBe('failed');
    expect(result.sourceHealth.market_data).toBe('ok');
    expect(result.events).toHaveLength(1);
  });

  it('reports archive failure separately from a healthy calendar with no eligible surprises', async () => {
    const { getCalendar } = await import('../calendar');
    vi.mocked(getCalendar).mockResolvedValueOnce({ events: [], surprises: [], fetchedAt: new Date().toISOString(), archiveStatus: 'failed' });
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();
    expect(result.sourceHealth.calendar_archive).toBe('failed');
    expect(result.sourceHealth.economic_calendar).toBe('failed');
    expect(result.sourceHealth.market_data).toBe('ok');
  });
  it('returns the next event from the same calendar fetch used for scoring', async () => {
    const { getCalendar } = await import('../calendar');
    const date = new Date(Date.now() + 3_600_000).toISOString();
    vi.mocked(getCalendar).mockResolvedValueOnce({ events: [{ id: 'future', title: 'CPI m/m', currency: 'USD', time: date, impact: 'high', forecast: '0.3%', previous: null, actual: null, affects: ['XAUUSD'] }], surprises: [], fetchedAt: new Date().toISOString(), archiveStatus: 'ok' });
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();
    expect(result.nextEvent).toEqual({ name: 'CPI m/m', country: 'USD', date, impact: 'high', affects: ['XAUUSD'] });
    expect(result.calendarEvidence?.events[0].forecast).toBe('0.3%');
    expect(result.calendarEvidence?.events[0].actual).toBeNull();
    expect(result.calendarEvidence?.archivedForecasts).toEqual([]);
  });
  it('recovers an expired snapshot without renewing its timestamp or dropping evidence metadata', async () => {
    const { fetchAllEvents } = await import('../api');
    const prior = await fetchAllEvents();
    const { getCacheEntry } = await import('../api/cache');
    const { fetchMarketData } = await import('../api/twelvedata');
    vi.mocked(getCacheEntry).mockResolvedValueOnce({ data: prior, fetchedAt: Date.now() - 1000, freshUntil: Date.now() - 1, staleUntil: Date.now() + 60_000 });
    vi.mocked(fetchMarketData).mockResolvedValueOnce([]);
    const result = await fetchAllEvents();
    expect(result.stale).toBe(true);
    expect(result.events).toEqual(prior.events);
    expect(result.cachedAt).toBe(prior.cachedAt);
  });
  it('rejects malformed upstream events while preserving provider failure visibility', async () => {
    const { fetchMarketData } = await import('../api/twelvedata');
    vi.mocked(fetchMarketData).mockResolvedValueOnce([{ id: 'invalid' }] as never);
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();
    expect(result.sourceHealth.market_data).toBe('failed');
    expect(result.events).toEqual([]);
  });
});
