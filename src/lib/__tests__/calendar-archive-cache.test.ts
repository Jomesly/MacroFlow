import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../types';

vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
vi.mock('../calendar/archive', () => ({ archiveForecasts: vi.fn() }));
const event: CalendarEvent = { id: 'cpi', title: 'CPI m/m', currency: 'USD', time: '2026-11-10T13:30:00Z', impact: 'high', forecast: '0.3%', previous: null, actual: null, affects: ['XAUUSD'] };

describe('shared forecast archive', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('coalesces concurrent callers and reuses success for subsequent dashboard requests', async () => {
    const { archiveForecasts } = await import('../calendar/archive');
    vi.mocked(archiveForecasts).mockResolvedValue({ status: 'ok', forecasts: new Map() });
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    await Promise.all([getArchivedForecasts([event]), getArchivedForecasts([event])]);
    await getArchivedForecasts([event]);
    expect(archiveForecasts).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await getArchivedForecasts([event]);
    expect(archiveForecasts).toHaveBeenCalledTimes(2);
  });

  it('retries archive failure instead of caching it as a healthy empty result', async () => {
    const { archiveForecasts } = await import('../calendar/archive');
    vi.mocked(archiveForecasts).mockResolvedValueOnce({ status: 'failed', forecasts: new Map() }).mockResolvedValue({ status: 'ok', forecasts: new Map() });
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    expect((await getArchivedForecasts([event])).status).toBe('failed');
    expect((await getArchivedForecasts([event])).status).toBe('ok');
    expect(archiveForecasts).toHaveBeenCalledTimes(2);
  });

  it('rechecks changed feed content and preserves archived observation time across processes', async () => {
    const { archiveForecasts } = await import('../calendar/archive');
    vi.mocked(archiveForecasts).mockResolvedValue({ status: 'ok', forecasts: new Map() });
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    await getArchivedForecasts([event]);
    await getArchivedForecasts([{ ...event, forecast: '0.5%' }]);
    expect(archiveForecasts).toHaveBeenCalledTimes(2);
    const { getCached } = await import('../api/cache');
    vi.mocked(getCached).mockResolvedValue({ forecasts: [[event.id, { forecast: '0.3%', firstSeenAt: '2026-11-09T12:00:00Z' }]], expiresAt: Date.now() + 60_000 });
    const result = await getArchivedForecasts([{ ...event, previous: '0.2%' }]);
    expect(result.forecasts.get(event.id)?.firstSeenAt).toBe('2026-11-09T12:00:00Z');
    expect(archiveForecasts).toHaveBeenCalledTimes(2);
  });
  it('does not extend a shared cached archive beyond its original expiry', async () => {
    const { getCached } = await import('../api/cache');
    vi.mocked(getCached).mockResolvedValue({ forecasts: [], expiresAt: Date.now() + 1_000 });
    const { archiveForecasts } = await import('../calendar/archive');
    vi.mocked(archiveForecasts).mockResolvedValue({ status: 'ok', forecasts: new Map() });
    const { getArchivedForecasts } = await import('../calendar/archive-cache');
    await getArchivedForecasts([event]);
    vi.advanceTimersByTime(1_001);
    await getArchivedForecasts([event]);
    expect(archiveForecasts).toHaveBeenCalledTimes(1);
  });
});
