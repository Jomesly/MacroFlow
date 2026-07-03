import { afterEach, describe, expect, it, vi } from 'vitest';

describe('FMP calendar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FMP_API_KEY;
  });

  it('keeps future pending events available for the next-event pipeline', async () => {
    process.env.FMP_API_KEY = 'test-key';
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [
        { event: 'US CPI', country: 'US', date: past, actual: 3.1, forecast: 3.0, previous: 2.9, description: null },
        { event: 'US Nonfarm Payrolls', country: 'US', date: future, actual: null, forecast: 180000, previous: 170000, description: null },
      ],
    })));

    const { fetchEconomicCalendar, fetchUpcomingEconomicCalendar } = await import('../api/fmp');
    const scored = await fetchEconomicCalendar();
    const upcoming = await fetchUpcomingEconomicCalendar();

    expect(scored.some((item) => item.title.includes('US CPI'))).toBe(true);
    expect(scored.some((item) => item.title.includes('Nonfarm Payrolls'))).toBe(false);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].name).toBe('US Nonfarm Payrolls');
  });
});
