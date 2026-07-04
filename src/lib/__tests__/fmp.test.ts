import { describe, expect, it } from 'vitest';

describe('FMP calendar (stubbed — pending FRED integration)', () => {
  it('fetchEconomicCalendar returns empty array', async () => {
    const { fetchEconomicCalendar } = await import('../api/fmp');
    const result = await fetchEconomicCalendar();
    expect(result).toEqual([]);
  });

  it('fetchUpcomingEconomicCalendar returns empty array', async () => {
    const { fetchUpcomingEconomicCalendar } = await import('../api/fmp');
    const result = await fetchUpcomingEconomicCalendar();
    expect(result).toEqual([]);
  });
});
