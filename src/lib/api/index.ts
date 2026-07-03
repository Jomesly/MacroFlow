import { MacroEvent } from '../types';
import { fetchEconomicCalendar } from './fmp';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { getCached, setCache } from './cache';

const CACHE_KEY = 'merged_events';
const CACHE_TTL = 900_000;

export async function fetchAllEvents(): Promise<MacroEvent[]> {
  const cached = await getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const results = await Promise.allSettled([
    fetchEconomicCalendar(),
    fetchNews(),
    fetchMarketData(),
    fetchRssFeeds(),
  ]);

  const allEvents: MacroEvent[] = [];
  const seenIds = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const event of result.value) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
    }
  }

  if (allEvents.length === 0) {
    return [];
  }

  await setCache(CACHE_KEY, allEvents, CACHE_TTL);
  return allEvents;
}
