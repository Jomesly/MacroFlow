import { MacroEvent, DataSource, SourceHealth, MacroContext, UpcomingEvent } from './types';
import { unknownContext } from './macro-context';
import { fetchAllEvents } from './api';

export const baselineEvents: MacroEvent[] = [
  {
    id: 'base-awaiting-data',
    category: 'other',
    title: 'Awaiting live market data',
    description: 'No fundamental events detected yet. The dashboard will update once RSS feeds and APIs return data.',
    timestamp: new Date().toISOString(),
    impact: 'low',
    value: 'neutral',
  },
];

export async function getEvents(): Promise<{
  events: MacroEvent[];
  source: DataSource;
  cachedAt: string;
  sourceHealth: SourceHealth;
  context: MacroContext;
  stale?: boolean;
  nextEvent: UpcomingEvent | null;
  calendarEvidence?: Awaited<ReturnType<typeof fetchAllEvents>>['calendarEvidence'];
}> {
  try {
    const { events: liveEvents, cachedAt, sourceHealth, stale, context, nextEvent, calendarEvidence } = await fetchAllEvents();

    if (liveEvents.length > 0) {
      return { events: liveEvents, source: 'live', cachedAt, sourceHealth, stale, context, nextEvent, calendarEvidence };
    }
    return { events: baselineEvents.map(e => ({ ...e, timestamp: cachedAt })), source: 'baseline', cachedAt, sourceHealth, context, nextEvent, calendarEvidence };
  } catch {
    // fall through
  }

  const cachedAt = new Date().toISOString();
  return {
    events: baselineEvents.map((e) => ({ ...e, timestamp: cachedAt })),
    source: 'baseline',
    cachedAt,
    context: unknownContext(cachedAt),
    nextEvent: null,
    sourceHealth: {
      finnhub: 'failed',
      market_data: 'failed',
      rss: 'failed',
      fred: 'failed',
      economic_calendar: 'failed',
      calendar_archive: 'failed',
    },
  };
}
