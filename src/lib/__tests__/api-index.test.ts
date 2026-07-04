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
  fetchFredEvents: vi.fn(async () => []),
}));

describe('fetchAllEvents source health', () => {
  it('reports ok and empty sources', async () => {
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();

    expect(result.sourceHealth.finnhub).toBe('empty');
    expect(result.sourceHealth.market_data).toBe('ok');
    expect(result.sourceHealth.rss).toBe('empty');
    expect(result.sourceHealth.fred).toBe('empty');
    expect(result.events).toHaveLength(1);
  });
});
