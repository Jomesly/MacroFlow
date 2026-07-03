import { MacroEvent, DataSource } from './types';
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
}> {
  try {
    const { events: liveEvents, cachedAt } = await fetchAllEvents();

    if (liveEvents.length > 0) {
      return { events: liveEvents, source: 'live', cachedAt };
    }
  } catch {
    // fall through
  }

  const cachedAt = new Date().toISOString();
  return {
    events: baselineEvents.map((e) => ({ ...e, timestamp: cachedAt })),
    source: 'baseline',
    cachedAt,
  };
}
