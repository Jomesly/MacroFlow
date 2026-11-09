import { MacroEvent, SourceHealth } from '../types';
import { z } from 'zod';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { fetchFredEvents } from './fred';
import { coalesce, getCacheEntry, setCache } from './cache';

const CACHE_KEY = 'merged_events';
const CACHE_TTL = 900_000;

const eventSchema = z.object({
  id: z.string().min(1), category: z.enum(['fed_tone', 'boe_tone', 'inflation', 'employment', 'gdp', 'pmi', 'retail_sales', 'geopolitical', 'risk_sentiment', 'dollar_strength', 'yields', 'crypto_regulation', 'earnings', 'other']),
  title: z.string(), description: z.string(), timestamp: z.iso.datetime(),
  impact: z.enum(['high', 'medium', 'low']), value: z.string(),
  country: z.string().optional(), url: z.string().optional(), sourceName: z.string().optional(),
});
const cachedEventsSchema = z.object({
  events: z.array(eventSchema), cachedAt: z.iso.datetime(),
  sourceHealth: z.record(z.string(), z.enum(['ok', 'empty', 'failed'])),
});

export async function fetchAllEvents(): Promise<{ events: MacroEvent[]; cachedAt: string; sourceHealth: SourceHealth; stale?: boolean }> {
  return coalesce(CACHE_KEY, async () => {
    const entry = await getCacheEntry<unknown>(CACHE_KEY);
    const parsed = cachedEventsSchema.safeParse(entry?.data);
    const cached = parsed.success ? parsed.data : null;
    if (cached && entry && Date.now() < entry.freshUntil) return cached;

    const sourceNames = ['finnhub', 'market_data', 'rss', 'fred'] as const;

    const rawResults = await Promise.allSettled([
      fetchNews(),
      fetchMarketData(),
      fetchRssFeeds(),
      fetchFredEvents(),
    ]);
    const results = rawResults.map((result) => {
      if (result.status === 'rejected') return result;
      const valid = z.array(eventSchema).safeParse(result.value);
      return valid.success
        ? { status: 'fulfilled' as const, value: valid.data }
        : { status: 'rejected' as const, reason: new Error('Invalid provider events') };
    });

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
      if (cached) {
        return { ...cached, sourceHealth, stale: true };
      }
      return { events: [], cachedAt: new Date().toISOString(), sourceHealth };
    }

    const cachedAt = new Date().toISOString();
    await setCache(CACHE_KEY, { events: allEvents, cachedAt, sourceHealth }, CACHE_TTL, 3_600_000);
    return { events: allEvents, cachedAt, sourceHealth };
  });
}
