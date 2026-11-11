import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRssFeeds } from '../api/rss';
import { fetchNews } from '../api/finnhub';

const { parseURL } = vi.hoisted(() => ({ parseURL: vi.fn() }));
vi.mock('rss-parser', () => ({ default: class { parseURL = parseURL; } }));
vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
const asOf = '2026-11-11T12:00:00.000Z';

describe('dated narrative ingestion', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    vi.stubEnv('RSS_MARKETWATCH', ''); vi.stubEnv('RSS_FXSTREET', 'https://example.com/rss');
    vi.stubEnv('RSS_COINDESK', ''); vi.stubEnv('RSS_INVESTING_GOLD', '');
    vi.stubEnv('FINNHUB_API_KEY', 'fixture-key');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('keeps dated FX stories beyond the old eight-item cutoff and skips malformed timestamps per item', async () => {
    parseURL.mockImplementation(async (url: string) => url !== 'https://example.com/rss' ? { items: [] } : { items: [
      { title: 'USD/JPY falls', isoDate: 'invalid' },
      { title: 'USD/JPY falls' },
      ...Array.from({ length: 8 }, () => ({ title: 'Market update', isoDate: asOf })),
      { title: 'USD/JPY rallies', isoDate: asOf, link: 'https://example.com/rally' },
      { title: 'USD/JPY climbs', isoDate: asOf, link: 'https://example.com/climb' },
      { title: 'USD/JPY falls', isoDate: '2026-11-12T12:00:00Z' },
    ] });
    const events = await fetchRssFeeds();
    const pairNews = events.filter(event => event.category === 'asset_sentiment');
    expect(pairNews).toHaveLength(2);
    expect(pairNews.every(event => event.value === 'bullish' && event.timestamp === asOf)).toBe(true);
  });

  it('retains distinct Finnhub stories and their publisher without inventing publication times', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [
      { id: 1, headline: 'USD/JPY rallies', summary: '', datetime: Date.parse(asOf) / 1000, url: 'https://example.com/1', source: 'Publisher' },
      { id: 2, headline: 'USD/JPY climbs', summary: '', datetime: Date.parse(asOf) / 1000, url: 'https://example.com/2', source: 'Publisher' },
      { id: 3, headline: 'USD/JPY falls', summary: '', datetime: 0 },
      { id: 4, headline: 'USD/JPY falls', summary: '', datetime: 'bad' },
    ] })));
    const events = await fetchNews();
    expect(events.filter(event => event.category === 'asset_sentiment')).toHaveLength(2);
    expect(events.every(event => event.timestamp === asOf && event.sourceName === 'Publisher')).toBe(true);
  });
});
