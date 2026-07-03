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
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

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
  const cached = await getCached<MacroEvent[]>(cacheKey);
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
          const publishedAt = (item.isoDate ?? item.pubDate ?? undefined) ? new Date(item.isoDate ?? item.pubDate!).toISOString() : undefined;
          if (publishedAt && Date.now() - new Date(publishedAt).getTime() > MAX_ARTICLE_AGE_MS) continue;

          const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
          const classifiedList = classifyHeadline(text);
          for (const classified of classifiedList) {
            const signal = `${classified.category}:${classified.value}`;
            if (!seen.has(signal)) {
              seen.add(signal);
              items.push(createEventFromClassification(classified, feed.sourceName, item.link, publishedAt));
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

  await setCache(cacheKey, allEvents, CACHE_TTL);
  return allEvents;
}
