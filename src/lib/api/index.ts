import type { MacroEvent, MacroContext, SourceHealth, UpcomingEvent } from '../types';
import { unknownContext } from '../macro-context';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { fetchFredInputs } from './fred';
import { getCalendar, nextHighEvent } from '../calendar';
import { getCached, setCache } from './cache';

interface CachedEvents {
  events: MacroEvent[];
  context: MacroContext;
  cachedAt: string;
  sourceHealth: SourceHealth;
  nextEvent: UpcomingEvent | null;
}

export async function fetchAllEvents(): Promise<CachedEvents & { stale?: boolean }> {
  const cached = await getCached<CachedEvents>('merged_events_v5');
  if (cached && Array.isArray(cached.events) && cached.context && cached.sourceHealth && cached.cachedAt) return cached;
  const asOf = new Date().toISOString();
  const names = ['finnhub', 'market_data', 'rss'] as const;
  const [results, fred, calendar] = await Promise.all([
    Promise.allSettled([fetchNews(), fetchMarketData(), fetchRssFeeds()]),
    fetchFredInputs(asOf).catch(() => ({ context: unknownContext(asOf), events: [] as MacroEvent[], failed: true })),
    getCalendar(asOf).catch(() => null),
  ]);
  const events: MacroEvent[] = [...fred.events];
  const sourceHealth: SourceHealth = {};
  results.forEach((result, index) => {
    sourceHealth[names[index]] = result.status === 'rejected' ? 'failed' : result.value.length ? 'ok' : 'empty';
    if (result.status === 'fulfilled') events.push(...result.value);
  });
  sourceHealth.fred = fred.failed ? 'failed' : fred.context.complete ? 'ok' : 'empty';
  sourceHealth.calendar_archive = calendar?.archiveStatus ?? 'failed';
  sourceHealth.economic_calendar = !calendar || calendar.archiveStatus === 'failed' ? 'failed' : calendar.surprises.length ? 'ok' : 'empty';
  if (calendar && calendar.archiveStatus === 'ok') events.push(...calendar.surprises);
  const data: CachedEvents = { events, context: fred.context, cachedAt: asOf, sourceHealth, nextEvent: nextHighEvent(calendar?.events ?? [], asOf) };
  await setCache('merged_events_v5', data, 60_000);
  return data;
}
