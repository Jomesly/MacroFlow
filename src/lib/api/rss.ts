import Parser from 'rss-parser';
import { MacroEvent } from '../types';
import { classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, setCache } from './cache';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const parser = new Parser({
  headers: { 'User-Agent': UA, 'Accept': 'application/xml, text/xml, text/html' },
  timeout: 10000,
});
const CACHE_TTL = 300_000;

interface FeedConfig {
  envKey: string;
  sourceName: string;
  maxItems: number;
}

const FEEDS: FeedConfig[] = [
  { envKey: 'RSS_MARKETWATCH', sourceName: 'marketwatch', maxItems: 8 },
  { envKey: 'RSS_FXSTREET', sourceName: 'fxstreet', maxItems: 8 },
  { envKey: 'RSS_COINDESK', sourceName: 'coindesk', maxItems: 5 },
  { envKey: 'RSS_INVESTING_GOLD', sourceName: 'investing-gold', maxItems: 5 },
];

export async function fetchRssFeeds(): Promise<MacroEvent[]> {
  const cacheKey = 'rss_events';
  const cached = getCached<MacroEvent[]>(cacheKey);
  if (cached) return cached;

  const allEvents: MacroEvent[] = [];

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const url = process.env[feed.envKey];
      if (!url) return [];

      try {
        const parsed = await parser.parseURL(url);
        if (!parsed?.items?.length) return [];

        const seen = new Set<string>();
        const items: MacroEvent[] = [];
        for (const item of parsed.items.slice(0, feed.maxItems)) {
          const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
          const classified = classifyHeadline(text);
          if (classified) {
            const signal = `${classified.category}:${classified.value}`;
            if (!seen.has(signal)) {
              seen.add(signal);
              items.push(createEventFromClassification(classified, feed.sourceName));
            }
          }
        }
        return items;
      } catch {
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  setCache(cacheKey, allEvents, CACHE_TTL);
  return allEvents;
}
