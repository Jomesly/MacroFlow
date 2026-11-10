import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/cache', () => ({
  getCached: vi.fn(async () => null),
  setCache: vi.fn(async () => undefined),
}));

vi.mock('../api/finnhub', () => ({
  fetchNews: vi.fn(async () => []),
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
}));

vi.mock('../api/fred', () => ({
  fetchFredInputs: vi.fn(async () => ({ events: [], context: { complete: false }, failed: false })),
}));

vi.mock('../calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../calendar')>()),
  getCalendar: vi.fn(async () => ({ events: [], surprises: [], fetchedAt: new Date().toISOString(), archiveStatus: 'ok' as const })),
}));

describe('fetchAllEvents source health', () => {
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
  });
});
