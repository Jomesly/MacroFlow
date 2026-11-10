import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveActual, fetchUsActual, formatActual, parseFeedNumber, US_RELEASES } from '../calendar/us-actuals';
import type { CalendarEvent } from '../types';

const release = '2026-11-10';
const rows = (latest: number, prior: number) => [{ date: '2026-10-01', value: latest }, { date: '2026-09-01', value: prior }];
const PREVIOUS = '2026-09-01'; // newest observation in the day-before vintage

describe('US actuals from a same-day ALFRED vintage', () => {
  it('derives each release in the feed style', () => {
    expect(formatActual(deriveActual('pct_change', 1, rows(315.9, 315.0), PREVIOUS)!, 'pct_change')).toBe('0.3%');
    expect(formatActual(deriveActual('change_k', 0, rows(159545, 159400), PREVIOUS)!, 'change_k')).toBe('145K');
    expect(formatActual(deriveActual('level', 1, rows(4.3, 4.2), PREVIOUS)!, 'level')).toBe('4.3%');
    expect(formatActual(deriveActual('level_k', 0, rows(229000, 221000), PREVIOUS)!, 'level_k')).toBe('229K');
  });
  it('returns nothing unless the release-day vintage has a newer observation than the day before', () => {
    expect(deriveActual('pct_change', 1, rows(315.9, 315.0), '2026-10-01')).toBeNull();
    expect(deriveActual('pct_change', 1, rows(315.9, 315.0), null)).toBeNull();
    expect(deriveActual('pct_change', 1, [], PREVIOUS)).toBeNull();
  });
  it('never prints negative zero', () => {
    expect(formatActual(deriveActual('pct_change', 1, rows(315.0, 315.01), PREVIOUS)!, 'pct_change')).toBe('0.0%');
  });
  it('parses feed numbers', () => {
    expect(parseFeedNumber('0.3%')).toBe(0.3);
    expect(parseFeedNumber('145K')).toBe(145);
    expect(parseFeedNumber('-12K')).toBe(-12);
    expect(parseFeedNumber('1.2M')).toBe(1200);
    expect(parseFeedNumber('')).toBeNull();
    expect(parseFeedNumber(null)).toBeNull();
    expect(parseFeedNumber('n/a')).toBeNull();
  });
  it('maps only exact US release titles', () => {
    expect(US_RELEASES['CPI m/m'].series).toBe('CPIAUCSL');
    expect(US_RELEASES['Non-Farm Employment Change']).toMatchObject({ series: 'PAYEMS', kind: 'change_k', decimals: 0 });
    expect(US_RELEASES['Fed Chair Speaks']).toBeUndefined();
  });
});

describe('fetchUsActual', () => {
  afterEach(() => vi.unstubAllGlobals());
  const event: CalendarEvent = { id: 'x', title: 'CPI m/m', currency: 'USD', time: '2026-11-10T13:30:00.000Z', impact: 'high',
    forecast: '0.3%', previous: '0.6%', actual: null, affects: [] };

  // FRED clips realtime_start to the query window, so every row reports the requested day.
  const vintage = (newest: string) => (url: URL) => {
    const day = url.searchParams.get('realtime_start')!;
    const observations = newest === 'stale' || day !== release
      ? [{ date: '2026-09-01', value: '315.0', realtime_start: day }, { date: '2026-08-01', value: '314.1', realtime_start: day }]
      : [{ date: '2026-10-01', value: '315.9', realtime_start: day }, { date: '2026-09-01', value: '315.0', realtime_start: day }];
    return new Response(JSON.stringify({ observations }));
  };
  it('reports an actual only when a new observation appeared on release day', async () => {
    const fetchMock = vi.fn(async (input: URL | string) => vintage('new')(new URL(String(input))));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchUsActual(event, 'key')).resolves.toBe('0.3%');
    const days = fetchMock.mock.calls.map(call => new URL(String(call[0])).searchParams.get('realtime_end'));
    expect(days.sort()).toEqual(['2026-11-09', release]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('series_id')).toBe('CPIAUCSL');
  });
  it("does not mistake last month's value for today's release before FRED updates", async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => vintage('stale')(new URL(String(input)))));
    await expect(fetchUsActual(event, 'key')).resolves.toBeNull();
  });
  it('uses the New York date for a late-evening release', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ observations: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUsActual({ ...event, time: '2026-11-11T02:00:00.000Z' }, 'key');
    const days = fetchMock.mock.calls.map(call => new URL(String((call as unknown[])[0])).searchParams.get('realtime_start'));
    expect(days).toContain('2026-11-10');
  });
  it('returns null for unmapped titles, HTTP errors and missing values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    await expect(fetchUsActual({ ...event, title: 'Fed Chair Speaks' }, 'key')).resolves.toBeNull();
    await expect(fetchUsActual(event, 'key')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ observations: [{ date: '2026-10-01', value: '.', realtime_start: release }] }))));
    await expect(fetchUsActual(event, 'key')).resolves.toBeNull();
  });
});
