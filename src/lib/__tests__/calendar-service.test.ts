import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';

vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
vi.mock('../calendar/feed', () => ({ fetchWeeklyFeed: vi.fn() }));
vi.mock('../calendar/archive-cache', () => ({ getArchivedForecasts: vi.fn() }));
vi.mock('../calendar/us-actuals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../calendar/us-actuals')>()),
  fetchUsActual: vi.fn(async () => '0.5%'),
}));

const asOf = '2026-11-10T15:00:00.000Z';
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: over.title ?? 'x', title: 'CPI m/m', currency: 'USD', time: '2026-11-10T13:30:00.000Z',
  impact: 'high', forecast: '0.3%', previous: '0.6%', actual: null, affects: ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'], ...over });

describe('nextHighEvent', () => {
  it('picks the first future high-impact event that affects a traded market', async () => {
    const { nextHighEvent } = await import('../calendar');
    const events = [
      event({ title: 'Past', time: '2026-11-10T14:00:00.000Z' }),
      event({ title: 'Medium', impact: 'medium', time: '2026-11-10T16:00:00.000Z' }),
      event({ title: 'Yen', currency: 'JPY', affects: [], time: '2026-11-10T16:30:00.000Z' }),
      event({ title: 'NFP', time: '2026-11-10T17:00:00.000Z' }),
    ];
    expect(nextHighEvent(events, asOf)).toEqual({ name: 'NFP', country: 'USD', date: '2026-11-10T17:00:00.000Z', impact: 'high',
      affects: ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] });
    expect(nextHighEvent(events.slice(0, 3), asOf)).toBeNull();
  });
});

describe('getCalendar', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.FRED_API_KEY = 'key'; });

  it('rejects when the feed fails', async () => {
    const { fetchWeeklyFeed } = await import('../calendar/feed');
    vi.mocked(fetchWeeklyFeed).mockRejectedValue(new Error('HTTP 429'));
    const { getCalendar } = await import('../calendar');
    await expect(getCalendar(asOf)).rejects.toThrow('HTTP 429');
  });

  it('fills actuals for released mapped US events only and scores archived forecasts', async () => {
    const { fetchWeeklyFeed } = await import('../calendar/feed');
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    const { fetchUsActual } = await import('../calendar/us-actuals');
    const cpi = event({ id: 'cpi' });
    const later = event({ id: 'later', title: 'Unemployment Rate', time: '2026-11-10T17:00:00.000Z' });
    const speech = event({ id: 'speech', title: 'Fed Chair Speaks', forecast: null });
    vi.mocked(fetchWeeklyFeed).mockResolvedValue([cpi, later, speech]);
    vi.mocked(getArchivedForecasts).mockResolvedValue({ status: 'ok', forecasts: new Map([['cpi', { forecast: '0.3%', firstSeenAt: '2026-11-09T00:00:00.000Z' }]]) });
    const { getCalendar } = await import('../calendar');
    const result = await getCalendar(asOf);
    expect(getArchivedForecasts).toHaveBeenCalledWith([cpi, later, speech]);
    expect(vi.mocked(fetchUsActual)).toHaveBeenCalledTimes(1);
    expect(result.events.find(e => e.id === 'cpi')?.actual).toBe('0.5%');
    expect(result.events.find(e => e.id === 'later')?.actual).toBeNull();
    expect(result.surprises).toHaveLength(1);
    expect(result.surprises[0]).toMatchObject({ category: 'inflation', value: 'high' });
    expect(result.archiveStatus).toBe('ok');
    expect(result.archivedForecasts).toEqual([['cpi', { forecast: '0.3%', firstSeenAt: '2026-11-09T00:00:00.000Z' }]]);
  });

  it('retains feed events but reports archive failure without scoring surprises', async () => {
    const { fetchWeeklyFeed } = await import('../calendar/feed');
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    vi.mocked(fetchWeeklyFeed).mockResolvedValue([event({ id: 'cpi' })]);
    vi.mocked(getArchivedForecasts).mockResolvedValue({ forecasts: new Map(), status: 'failed' });
    const { getCalendar } = await import('../calendar');
    const result = await getCalendar(asOf);
    expect(result.events).toHaveLength(1);
    expect(result.surprises).toEqual([]);
    expect(result.archiveStatus).toBe('failed');
  });
});
