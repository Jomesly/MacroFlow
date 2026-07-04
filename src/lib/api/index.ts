import { MacroEvent, SourceHealth } from '../types';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { getCached, setCache } from './cache';

const CACHE_KEY = 'merged_events';
const CACHE_TTL = 900_000;

interface CachedEvents {
  events: MacroEvent[];
  cachedAt: string;
  sourceHealth: SourceHealth;
}

export async function fetchAllEvents(): Promise<{ events: MacroEvent[]; cachedAt: string; sourceHealth: SourceHealth; stale?: boolean }> {
  const cached = await getCached<unknown>(CACHE_KEY);
  const isValid = cached !== null && typeof cached === 'object' && !Array.isArray(cached) && 'events' in (cached as any) && 'cachedAt' in (cached as any) && 'sourceHealth' in (cached as any);
  if (isValid) return cached as CachedEvents;

  const sourceNames = ['finnhub', 'market_data', 'rss'] as const;

  const results = await Promise.allSettled([
    fetchNews(),
    fetchMarketData(),
    fetchRssFeeds(),
  ]);

  const allEvents: MacroEvent[] = [];
  const seenIds = new Set<string>();
  const sourceHealth: SourceHealth = {};

  results.forEach((result, index) => {
    const sourceName = sourceNames[index];
    sourceHealth[sourceName] = result.status === 'rejected'
      ? 'failed'
      : result.value.length > 0
        ? 'ok'
        : 'empty';
  });

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
    if (isValid) {
      return { ...(cached as CachedEvents), sourceHealth, stale: true };
    }
    return { events: [], cachedAt: new Date().toISOString(), sourceHealth };
  }

  const cachedAt = new Date().toISOString();
  await setCache(CACHE_KEY, { events: allEvents, cachedAt, sourceHealth }, CACHE_TTL);
  return { events: allEvents, cachedAt, sourceHealth };
}
