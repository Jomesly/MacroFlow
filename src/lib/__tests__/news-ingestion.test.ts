import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRssFeeds, getRssFeedHealth } from '../api/rss';
import { fetchNews } from '../api/finnhub';

const { parseURL } = vi.hoisted(() => ({ parseURL: vi.fn() }));
vi.mock('rss-parser', () => ({ default: class { parseURL = parseURL; } }));
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock('../api/cache', () => ({
  getCached: vi.fn(async () => null),
  getCacheEntry: vi.fn(async (key: string) => (store.has(key) ? { data: store.get(key) } : null)),
  setCache: vi.fn(async (key: string, data: unknown) => { store.set(key, data); }),
}));
const asOf = '2026-11-11T12:00:00.000Z';

describe('dated narrative ingestion', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    store.clear(); parseURL.mockReset();
    vi.stubEnv('RSS_MARKETWATCH', ''); vi.stubEnv('RSS_FXSTREET', 'https://example.com/rss');
    vi.stubEnv('RSS_COINDESK', ''); vi.stubEnv('RSS_INVESTING_GOLD', '');
    vi.stubEnv('RSS_INVESTINGLIVE', ''); vi.stubEnv('RSS_YAHOO_FX', '');
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

  it("keeps a feed's last successful stories when that feed fails, instead of dropping them", async () => {
    const feed = { items: [{ title: 'USD/JPY rallies', isoDate: asOf, link: 'https://example.com/rally' }] };
    parseURL.mockImplementation(async (url: string) => url === 'https://example.com/rss' ? feed : { items: [{ title: 'Market update', isoDate: asOf }] });
    const healthy = await fetchRssFeeds();
    expect(healthy.filter(event => event.category === 'asset_sentiment')).toHaveLength(1);

    parseURL.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/rss') throw new Error('timeout');
      return { items: [{ title: 'Market update', isoDate: asOf }] };
    });
    const duringOutage = await fetchRssFeeds();
    expect(duringOutage.filter(event => event.category === 'asset_sentiment')).toEqual(healthy.filter(event => event.category === 'asset_sentiment'));
    const { setCache } = await import('../api/cache');
    expect(vi.mocked(setCache).mock.calls.at(-1)).toEqual(['rss_events_v11', duringOutage, 60_000]);
    expect(await getRssFeedHealth()).toMatchObject({ feed_fxstreet: 'failed', feed_marketwatch_market_pulse: 'ok', feed_investinglive: 'empty' });
  });

  it('reads only the lead of a long article, so a full market wrap cannot spray signals', async () => {
    const wrap = `Markets were quiet. ${'Filler sentence about nothing in particular. '.repeat(12)}USD/JPY rallies late in the session.`;
    parseURL.mockImplementation(async (url: string) => url !== 'https://example.com/rss' ? { items: [{ title: 'Market update', isoDate: asOf }] } : { items: [
      { title: 'Daily wrap', contentSnippet: wrap, isoDate: asOf, link: 'https://example.com/wrap' },
      { title: 'USD/JPY rallies', contentSnippet: 'Short lead.', isoDate: asOf, link: 'https://example.com/lead' },
    ] });
    const pairNews = (await fetchRssFeeds()).filter(event => event.category === 'asset_sentiment');
    expect(pairNews.map(event => event.url)).toEqual(['https://example.com/lead']);
  });

  it('retries a feed once before treating it as failed', async () => {
    let attempts = 0;
    parseURL.mockImplementation(async (url: string) => {
      if (url !== 'https://example.com/rss') return { items: [{ title: 'Market update', isoDate: asOf }] };
      if (++attempts === 1) throw new Error('reset');
      return { items: [{ title: 'USD/JPY rallies', isoDate: asOf, link: 'https://example.com/rally' }] };
    });
    const events = await fetchRssFeeds();
    expect(attempts).toBe(2);
    expect(events.filter(event => event.category === 'asset_sentiment')).toHaveLength(1);
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
