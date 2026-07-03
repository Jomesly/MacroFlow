import { MacroEvent } from '../types';
import { fetchEconomicCalendar } from './fmp';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { getCached, setCache } from './cache';

const CACHE_KEY = 'merged_events';
const CACHE_TTL = 900_000;

interface CachedEvents {
  events: MacroEvent[];
  cachedAt: string;
}

export async function fetchAllEvents(): Promise<{ events: MacroEvent[]; cachedAt: string }> {
  const cached = await getCached<CachedEvents>(CACHE_KEY);
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
    return { events: [], cachedAt: new Date().toISOString() };
  }

  const cachedAt = new Date().toISOString();
  await setCache(CACHE_KEY, { events: allEvents, cachedAt }, CACHE_TTL);
  return { events: allEvents, cachedAt };
}
