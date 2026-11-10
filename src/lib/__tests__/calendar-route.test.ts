import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/calendar/consensus/route';
import { getCalendar } from '../calendar';

vi.mock('../calendar', () => ({ getCalendar: vi.fn() }));

describe('calendar route', () => {
  it('keeps feed availability separate from failed archive health without exposing database errors', async () => {
    vi.mocked(getCalendar).mockResolvedValue({ events: [], surprises: [], fetchedAt: '2026-11-10T12:00:00Z', archiveStatus: 'failed' });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [], fetchedAt: '2026-11-10T12:00:00Z', archiveStatus: 'failed', source: 'ForexFactory' });
  });
  it('reports unavailable feed with a generic error', async () => {
    vi.mocked(getCalendar).mockRejectedValue(new Error('private provider details'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Calendar unavailable' });
  });
});
