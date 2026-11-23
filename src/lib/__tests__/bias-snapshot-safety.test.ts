import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEvents } from '../events';
import { buildBiasSnapshot } from '../bias-snapshot';
import { buildMacroInputs } from '../macro-context';
import { contextFixture } from './fixtures/macro';
import type { CalendarEvent } from '../types';

vi.mock('../events', () => ({ getEvents: vi.fn() }));

const asOf = '2026-11-10T12:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(asOf) + minutes * 60_000).toISOString();
function readyInputs() {
  return {
    ...buildMacroInputs(contextFixture(), asOf), source: 'live' as const, cachedAt: asOf, nextEvent: null,
    sourceHealth: { finnhub: 'ok' as const, rss: 'ok' as const, market_data: 'ok' as const,
      fred: 'ok' as const, calendar_archive: 'ok' as const, economic_calendar: 'empty' as const },
    calendarEvidence: { fetchedAt: asOf, archiveStatus: 'ok' as const, archivedForecasts: [], events: [
      { id: 'later-release', title: 'Later release', currency: 'USD', time: at(300), impact: 'low' as const,
        forecast: null, previous: null, actual: null, affects: ['US100'] },
    ] as CalendarEvent[] },
  };
}
const check = (snapshot: Awaited<ReturnType<typeof buildBiasSnapshot>>, id: string) =>
  snapshot.results[0].grade.checks.find(row => row.id === id);

describe('snapshot signal safety', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    vi.mocked(getEvents).mockResolvedValue(readyInputs());
  });
  afterEach(() => vi.useRealTimers());

  it('accepts a fresh calendar with no release surprises and no event in the forecast window', async () => {
    const snapshot = await buildBiasSnapshot('US100');
    expect(snapshot.meta.inputsHealthy).toBe(true);
    expect(check(snapshot, 'no_event_risk')?.passed).toBe(true);
  });

  it('does not let a successful aggregate fetch hide a failed news feed', async () => {
    const inputs = readyInputs();
    vi.mocked(getEvents).mockResolvedValue({ ...inputs, sourceHealth: { ...inputs.sourceHealth, feed_coindesk: 'failed' } });
    const snapshot = await buildBiasSnapshot('US100');
    expect(snapshot.meta.inputsHealthy).toBe(false);
    expect(check(snapshot, 'healthy_inputs')?.passed).toBe(false);
    expect(snapshot.results[0].signal).toBe('neutral');
  });

  it('permits explicitly disabled feeds while configured feeds remain healthy', async () => {
    const inputs = readyInputs();
    vi.mocked(getEvents).mockResolvedValue({ ...inputs, sourceHealth: { ...inputs.sourceHealth, feed_fxstreet: 'empty' } });
    expect((await buildBiasSnapshot('US100')).meta.inputsHealthy).toBe(true);
  });

  it('requires health metadata for the macro and calendar providers', async () => {
    vi.mocked(getEvents).mockResolvedValue({ ...readyInputs(), sourceHealth: { rss: 'ok' } });
    expect((await buildBiasSnapshot('US100')).meta.inputsHealthy).toBe(false);
  });

  it('does not report healthy macro inputs when the economic context is incomplete', async () => {
    const inputs = readyInputs();
    vi.mocked(getEvents).mockResolvedValue({ ...inputs, context: { ...inputs.context, complete: false } });
    expect((await buildBiasSnapshot('US100')).meta.inputsHealthy).toBe(false);
  });

  it.each(['missing', 'empty', 'stale', 'future', 'failed_archive', 'past_only', 'invalid_time'] as const)(
    'cannot clear event risk with a %s calendar', async kind => {
      const inputs = readyInputs();
      if (kind === 'missing') vi.mocked(getEvents).mockResolvedValue({ ...inputs, calendarEvidence: undefined });
      else {
        const calendar = { ...inputs.calendarEvidence };
        if (kind === 'empty') calendar.events = [];
        if (kind === 'stale') calendar.fetchedAt = at(-61);
        if (kind === 'future') calendar.fetchedAt = at(1);
        if (kind === 'past_only') calendar.events = calendar.events.map(row => ({ ...row, time: at(-60) }));
        if (kind === 'invalid_time') calendar.events = calendar.events.map(row => ({ ...row, time: 'invalid' }));
        vi.mocked(getEvents).mockResolvedValue({ ...inputs, calendarEvidence: kind === 'failed_archive'
          ? { ...calendar, archiveStatus: 'failed' } : calendar });
      }
      const snapshot = await buildBiasSnapshot('US100');
      expect(check(snapshot, 'no_event_risk')?.passed).toBe(false);
      expect(snapshot.meta.inputsHealthy).toBe(false);
    },
  );

  it('blocks a high-impact release scheduled exactly at the issue time', async () => {
    const inputs = readyInputs();
    inputs.calendarEvidence.events.push({ ...inputs.calendarEvidence.events[0], id: 'now', title: 'CPI', time: asOf,
      impact: 'high' });
    vi.mocked(getEvents).mockResolvedValue(inputs);
    expect(check(await buildBiasSnapshot('US100'), 'no_event_risk')?.passed).toBe(false);
  });
});
