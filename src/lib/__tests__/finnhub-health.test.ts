import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNews, getFinnhubNewsHealth } from '../api/finnhub';

const { store } = vi.hoisted(() => ({ store: new Map<string, { data: unknown; freshUntil: number; staleUntil: number }>() }));
vi.mock('../api/cache', () => ({
  getCached: vi.fn(async (key: string) => {
    const entry = store.get(key);
    return entry && Date.now() < entry.freshUntil ? entry.data : null;
  }),
  getCacheEntry: vi.fn(async (key: string) => {
    const entry = store.get(key);
    return entry && Date.now() < entry.staleUntil ? entry : null;
  }),
  setCache: vi.fn(async (key: string, data: unknown, ttl: number, maxAge = ttl) => {
    const entry = { data, freshUntil: Date.now() + ttl, staleUntil: Date.now() + maxAge };
    store.set(key, entry);
    return entry;
  }),
}));

const asOf = '2026-11-23T12:00:00.000Z';
const deskHealth = (general: string, forex = general, crypto = general) => ({
  feed_finnhub_general: general, feed_finnhub_forex: forex, feed_finnhub_crypto: crypto,
});
const article = (id: number, headline: string) => ({
  id, headline, summary: '', datetime: Date.parse(asOf) / 1000,
  url: `https://example.com/article/${id}`, source: 'News desk',
});
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const categoryOf = (url: string) => new URL(url).searchParams.get('category');

describe('Finnhub desk health', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    vi.stubEnv('FINNHUB_API_KEY', 'fixture-key'); store.clear();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('reports HTTP, network and malformed-body failures instead of healthy empty news', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (categoryOf(url) === 'general') return response({ error: 'rate limited' });
      if (categoryOf(url) === 'forex') throw new Error('network unavailable');
      return response([], 503);
    }));
    expect(await fetchNews()).toEqual([]);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('failed'));
  });

  it('keeps usable stories while exposing one failed desk', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const category = categoryOf(url);
      return category === 'forex' ? response([], 429)
        : response([article(category === 'general' ? 1 : 2, category === 'general' ? 'Gold rallies' : 'Bitcoin rallies')]);
    }));
    const events = await fetchNews();
    expect(events.map(event => event.symbol)).toContain('XAUUSD');
    expect(events.map(event => event.symbol)).toContain('BTCUSD');
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('ok', 'failed', 'ok'));
  });

  it('treats successful empty desks as empty, with a five-minute cache', async () => {
    const fetchMock = vi.fn(async () => response([])); vi.stubGlobal('fetch', fetchMock);
    expect(await fetchNews()).toEqual([]);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('empty'));
    vi.advanceTimersByTime(299_999);
    expect(await fetchNews()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    await fetchNews();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('retries degraded desks after one minute and updates cached events and health together', async () => {
    let failing = true;
    const fetchMock = vi.fn(async (url: string) => categoryOf(url) === 'forex' && failing
      ? response([], 503) : response([article(1, 'USD/JPY rallies')]));
    vi.stubGlobal('fetch', fetchMock);
    const original = await fetchNews();
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('ok', 'failed', 'ok'));
    failing = false;
    vi.advanceTimersByTime(59_999);
    expect(await fetchNews()).toEqual(original);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('ok', 'failed', 'ok'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    await fetchNews();
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('ok'));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('caches total failure briefly so it remains visible and can recover', async () => {
    let failing = true;
    const fetchMock = vi.fn(async () => response([], failing ? 500 : 200));
    vi.stubGlobal('fetch', fetchMock);
    await fetchNews();
    await fetchNews();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('failed'));
    failing = false; vi.advanceTimersByTime(60_000);
    await fetchNews();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('empty'));
  });

  it('shows a missing API key as intentionally disabled, even after a cached failure', async () => {
    const fetchMock = vi.fn(async () => response([], 500)); vi.stubGlobal('fetch', fetchMock);
    await fetchNews();
    vi.stubEnv('FINNHUB_API_KEY', '');
    expect(await fetchNews()).toEqual([]);
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('empty'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not claim configured desks are healthy before a verified response exists', async () => {
    expect(await getFinnhubNewsHealth()).toEqual(deskHealth('failed'));
  });
});
