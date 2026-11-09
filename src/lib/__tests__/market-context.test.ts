import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { normalizeOfficialIcal, normalizeOns, nextCalendarEvent, fetchCalendar } from '../api/calendar';
import { parseOfficialIcal } from '../market/ical';
import { parseTreasuryCsv, yieldSpread, fetchMacroContext } from '../api/macro-context';
import { loadResource } from '../market/resource';
import { providerFetch } from '../market/http';
import type { CalendarData, MacroReading, Resource } from '../market/types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const meta = { provider: 'fixture', instrumentId: 'test', sourceUrl: 'https://example.com', observedAt: '2026-11-05T00:00:00.000Z', fetchedAt: null, freshUntil: null, staleUntil: null, status: 'fresh' as const, delayed: true };

const ics = (date: string, title = 'Consumer Price Index', extra = '') => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cpi-test\nDTSTART${date}\nSUMMARY:${title}\n${extra}END:VEVENT\nEND:VCALENDAR`;

describe('official economic calendar', () => {
  it('handles New York DST, UTC BEA dates, folded titles and source attribution', () => {
    expect(normalizeOfficialIcal(ics(';TZID=US-Eastern:20261110T083000'), 'BLS')[0]).toMatchObject({ date: '2026-11-10T13:30:00.000Z', sourceName: 'BLS', forecast: null, previous: null, actual: null });
    expect(normalizeOfficialIcal(ics(';TZID=US-Eastern:20260710T083000'), 'BLS')[0].date).toBe('2026-07-10T12:30:00.000Z');
    expect(normalizeOfficialIcal(ics(':20261125T133000Z', 'Gross Domestic Product\\, 3rd Quarter\n 2026'), 'BEA')[0]).toMatchObject({ title: 'Gross Domestic Product, 3rd Quarter2026', currency: 'USD' });
  });

  it('rejects floating times and recurrence, skips cancelled or all-day dates', () => {
    expect(() => parseOfficialIcal(ics(':20261110T083000'))).toThrow('timezone');
    expect(() => parseOfficialIcal(ics(';TZID=US-Eastern:20260308T023000'))).toThrow('Nonexistent');
    expect(() => parseOfficialIcal(ics(':20261110T133000Z', 'CPI', 'RRULE:FREQ=MONTHLY\n'))).toThrow('recurring');
    expect(parseOfficialIcal(ics(':20261110T133000Z', 'CPI', 'STATUS:CANCELLED\n'))).toEqual([]);
    expect(parseOfficialIcal(ics(';VALUE=DATE:20261110'))).toEqual([]);
    expect(() => parseOfficialIcal('<html>blocked</html>')).toThrow();
  });

  it('selects confirmed ONS bulletins, excludes duplicates and cancelled/provisional releases', () => {
    const row = (title: string, change = {}) => ({ uri: '/releases/ukgdp', description: { title, release_date: '2026-11-12T07:00:00Z', cancelled: false, postponed: false, finalised: true, ...change } });
    const raw = { breakdown: { total: 5 }, releases: [row('GDP monthly estimate, UK: September 2026'), row('GDP monthly estimate, UK: time series'), row('Retail sales, Great Britain', { cancelled: true }), row('UK Labour Market', { finalised: false }), row('UK Labour Market', { postponed: true })] };
    const events = normalizeOns(raw);
    expect(events).toHaveLength(1);
    expect(events[0].affects).toEqual(['GBPUSD']);
    expect(events[0].sourceUrl).toBe('https://www.ons.gov.uk/releases/ukgdp');
    expect(() => normalizeOns({ ...raw, breakdown: { total: 1001 } })).toThrow('Incomplete');
    const calendar: Resource<CalendarData> = { data: { events, windowStart: null, windowEnd: null }, meta };
    expect(nextCalendarEvent(calendar, Date.parse('2026-11-11T00:00:00Z'))?.name).toContain('GDP');
    expect(nextCalendarEvent(calendar, Date.parse('2026-11-13T00:00:00Z'))).toBeNull();
  });

  it('keeps a healthy agency when another fails and never calls Forex Factory', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    const fetch = vi.fn(async (url: string) => url.includes('bls.gov') ? new Response(ics(':20261110T133000Z')) : new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    const calendar = await fetchCalendar();
    expect(calendar.data?.events.length).toBe(1);
    expect(calendar.meta.status).toBe('stale');
    expect(calendar.data?.sources?.filter((s) => s.status === 'unavailable')).toHaveLength(2);
    expect(fetch.mock.calls.every(([url]) => !url.includes('faireconomy') && !url.includes('forexfactory'))).toBe(true);
  });
});

describe('official Treasury observations', () => {
  it('handles quoted columns, missing cells, future dates, and descending rows', () => {
    expect(parseTreasuryCsv('Date,"2 Yr","10 Yr"\r\n11/06/2026,4.51,4.86\r\n11/05/2026,0,N/A\r\n11/07/2026,,4.90\r\n11/10/2026,9,9', '2026-11-09')).toEqual({ two: { date: '2026-11-06', value: 4.51 }, ten: { date: '2026-11-07', value: 4.90 } });
    expect(parseTreasuryCsv('Date,2 Yr,10 Yr\n11/05/2026,0,.', '2026-11-09')).toEqual({ two: { date: '2026-11-05', value: 0 }, ten: null });
    expect(() => parseTreasuryCsv('<html>blocked</html>')).toThrow();
  });

  it('only computes spreads from matching valid observations and preserves stale state', () => {
    const two: Resource<MacroReading> = { data: { value: 4.46, unit: 'percent' }, meta };
    const ten: Resource<MacroReading> = { data: { value: 4.84, unit: 'percent' }, meta: { ...meta, status: 'stale' } };
    expect(yieldSpread(two, ten).data?.value).toBe(38);
    expect(yieldSpread(two, ten).meta.status).toBe('stale');
    expect(yieldSpread(two, { ...ten, meta: { ...meta, observedAt: '2026-11-04T00:00:00.000Z' } }).data).toBeNull();
    expect(yieldSpread(two, { ...ten, meta: { ...meta, status: 'unavailable' } }).data).toBeNull();
  });

  it('uses one Treasury snapshot and never requests unapproved DXY or VIX feeds', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response('Date,2 Yr,10 Yr\n11/06/2026,4.51,4.86'));
    vi.stubGlobal('fetch', fetch);
    const context = await fetchMacroContext();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('home.treasury.gov');
    expect(context.treasury2y.data?.value).toBe(4.51);
    expect(context.spread.data?.value).toBe(35);
    expect(context.dxy.data).toBeNull();
    expect(context.vix.data).toBeNull();
  });
});

describe('market resource recovery', () => {
  it('isolates local, production and individual preview caches', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('VERCEL_ENV', 'development');
    let value = 0;
    const load = vi.fn(async () => ({ data: { value: ++value }, observedAt: null }));
    const options = { key: 'scope-test', provider: 'fixture', instrumentId: 'fixture', sourceUrl: 'https://example.com', ttlMs: 1000, maxAgeMs: 2000, schema: z.object({ value: z.number() }), load };
    expect((await loadResource(options)).data?.value).toBe(1);
    vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('VERCEL_URL', 'preview-one.vercel.app');
    expect((await loadResource(options)).data?.value).toBe(2);
    expect((await loadResource(options)).data?.value).toBe(2);
    vi.stubEnv('VERCEL_URL', 'preview-two.vercel.app');
    expect((await loadResource(options)).data?.value).toBe(3);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await loadResource(options)).data?.value).toBe(4);
    vi.stubEnv('VERCEL_ENV', 'development');
    expect((await loadResource(options)).data?.value).toBe(1);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('shares refresh work, serves bounded stale results, and cools down failed sources', async () => {
    vi.useFakeTimers();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const load = vi.fn(async () => ({ data: { value: 42 }, observedAt: '2026-11-05T00:00:00.000Z' }));
    const options = { key: 'test-resource', provider: 'fixture', instrumentId: 'fixture', sourceUrl: 'https://example.com', ttlMs: 1000, maxAgeMs: 3000, schema: z.object({ value: z.number() }), load };
    const [first, second] = await Promise.all([loadResource(options), loadResource(options)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    vi.advanceTimersByTime(1001);
    load.mockRejectedValue(new Error('outage'));
    const stale = await loadResource(options);
    expect(stale.meta.status).toBe('stale');
    expect(stale.meta.fetchedAt).toBe(first.meta.fetchedAt);
    expect(stale.meta.observedAt).toBe(first.meta.observedAt);
    await loadResource(options);
    expect(load).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2000);
    expect((await loadResource(options)).meta.status).toBe('unavailable');
  });

  it('rejects invalid payloads and distinguishes valid empty data from unavailable', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const options = { key: 'test-invalid-resource', provider: 'fixture', instrumentId: 'fixture', sourceUrl: 'https://example.com', ttlMs: 1000, maxAgeMs: 2000, schema: z.array(z.string()), load: async () => ({ data: 5 as never, observedAt: null }) };
    expect((await loadResource(options)).meta.status).toBe('unavailable');
    expect((await loadResource({ ...options, key: 'test-empty-resource', empty: (data) => data.length === 0, load: async () => ({ data: [], observedAt: null }) })).meta.status).toBe('empty');
  });
});

describe('provider request limits', () => {
  it('does not retry rate limits or invalid requests', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(providerFetch('https://example.com')).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient server error once', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    expect((await providerFetch('https://example.com')).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
