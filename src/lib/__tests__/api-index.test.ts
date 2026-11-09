import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCacheEntry } from '../api/cache';
import { fetchMarketData } from '../api/twelvedata';

vi.mock('../api/cache', () => ({
  getCacheEntry: vi.fn(async () => null),
  coalesce: vi.fn(async (_key: string, load: () => Promise<unknown>) => load()),
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
  beforeEach(() => vi.clearAllMocks());
  it('reports ok and empty sources', async () => {
    const { fetchAllEvents } = await import('../api');
    const result = await fetchAllEvents();

    expect(result.sourceHealth.finnhub).toBe('empty');
    expect(result.sourceHealth.market_data).toBe('ok');
    expect(result.sourceHealth.rss).toBe('empty');
    expect(result.sourceHealth.fred).toBe('empty');
    expect(result.events).toHaveLength(1);
  });

  it('recovers an expired snapshot without changing its original timestamp', async () => {
    const { fetchAllEvents } = await import('../api');
    const prior = await fetchAllEvents();
    const entry = { data: prior, fetchedAt: Date.now() - 1000, freshUntil: Date.now() - 1, staleUntil: Date.now() + 60_000 };
    vi.mocked(getCacheEntry).mockResolvedValueOnce(entry);
    vi.mocked(fetchMarketData).mockResolvedValueOnce([]);
    const result = await fetchAllEvents();
    expect(result.stale).toBe(true);
    expect(result.events).toEqual(prior.events);
    expect(result.cachedAt).toBe(prior.cachedAt);
    expect(result.sourceHealth.market_data).toBe('empty');
  });

  it('rejects malformed source rows and preserves healthy providers', async () => {
    const { fetchAllEvents } = await import('../api');
    vi.mocked(fetchMarketData).mockResolvedValueOnce([{ id: 'invalid' }] as never);
    const result = await fetchAllEvents();
    expect(result.sourceHealth.market_data).toBe('failed');
    expect(result.events).toEqual([]);
  });
});
