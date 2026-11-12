import Parser from 'rss-parser';
import type { MacroEvent, SourceHealth } from '../types';
import { articleText, classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, getCacheEntry, setCache } from './cache';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const parser = new Parser({
  headers: { 'User-Agent': UA, 'Accept': 'application/xml, text/xml, text/html' },
  timeout: 10000,
});
const CACHE_TTL = 300_000;
/** A failed feed is retried sooner than a complete set is refreshed. */
const DEGRADED_TTL = 60_000;
/** How long a feed's last successful read may stand in for a failed one. */
const FEED_RETENTION_MS = 6 * 60 * 60 * 1000;
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;
/** Headline rules are written for a title and its lead, not a full market wrap. */
const MAX_SNIPPET_CHARS = 400;
const HEALTH_KEY = 'rss_feed_health_v1';

interface FeedConfig {
  envKey?: string;
  defaultUrl?: string;
  sourceName: string;
  maxItems: number;
}

const FEEDS: FeedConfig[] = [
  { envKey: 'RSS_EQUITIES', defaultUrl: 'https://finance.yahoo.com/rss/headline?s=QQQ,SPY,DIA', sourceName: 'Yahoo Finance equities', maxItems: 30 },
  { defaultUrl: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse', sourceName: 'MarketWatch Market Pulse', maxItems: 30 },
  { envKey: 'RSS_MARKETWATCH', sourceName: 'marketwatch', maxItems: 8 },
  { envKey: 'RSS_FXSTREET', defaultUrl: 'https://www.fxstreet.com/rss/news', sourceName: 'fxstreet', maxItems: 40 },
  // Independent FX and macro newswires, so currency markets never depend on one provider.
  { envKey: 'RSS_INVESTINGLIVE', defaultUrl: 'https://www.investinglive.com/feed/news', sourceName: 'InvestingLive', maxItems: 30 },
  { envKey: 'RSS_YAHOO_FX', defaultUrl: 'https://finance.yahoo.com/rss/headline?s=JPY=X,EURUSD=X,GBPUSD=X,AUDUSD=X,CAD=X,CHF=X,NZDUSD=X', sourceName: 'Yahoo Finance FX', maxItems: 20 },
  { envKey: 'RSS_COINDESK', sourceName: 'coindesk', maxItems: 5 },
  { envKey: 'RSS_INVESTING_GOLD', sourceName: 'investing-gold', maxItems: 5 },
];

const healthKey = (sourceName: string) => `feed_${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

/** Per-feed status from the latest fetch, so one silent outage is visible to traders. */
export async function getRssFeedHealth(): Promise<SourceHealth> {
  const entry = await getCacheEntry<SourceHealth>(HEALTH_KEY);
  return entry?.data && typeof entry.data === 'object' ? entry.data : {};
}

export async function fetchRssFeeds(): Promise<MacroEvent[]> {
  const cacheKey = 'rss_events_v11';
  const cached = await getCached<MacroEvent[]>(cacheKey);
  if (cached) return cached;

  const allEvents: MacroEvent[] = [];
  const health: SourceHealth = {};
  let degraded = false;

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const configured = feed.envKey ? process.env[feed.envKey] : undefined;
      const url = configured ?? feed.defaultUrl;
      if (!url) {
        // A blank setting switches a built-in feed off; show that instead of hiding it.
        if (configured === '' && feed.defaultUrl) health[healthKey(feed.sourceName)] = 'empty';
        return [];
      }
      const feedKey = `rss_feed_v1:${feed.sourceName}`;

      try {
        // One immediate retry covers a transient timeout or reset.
        const parsed = await parser.parseURL(url).catch(() => parser.parseURL(url));
        if (!parsed?.items?.length) throw new Error('Feed returned no items');

        const seen = new Set<string>();
        const items: MacroEvent[] = [];
        for (const item of parsed.items.slice(0, feed.maxItems)) {
          const publishedMs = Date.parse(item.isoDate ?? item.pubDate ?? '');
          if (!Number.isFinite(publishedMs) || publishedMs > Date.now() || Date.now() - publishedMs > MAX_ARTICLE_AGE_MS) continue;
          const publishedAt = new Date(publishedMs).toISOString();

          const text = articleText(item.title, item.contentSnippet, MAX_SNIPPET_CHARS);
          const classifiedList = classifyHeadline(text);
          for (const classified of classifiedList) {
            const signal = `${item.link ?? item.title}:${classified.category}:${classified.value}:${classified.country ?? ''}:${classified.symbol ?? ''}`;
            if (!seen.has(signal)) {
              seen.add(signal);
              items.push(createEventFromClassification(classified, feed.sourceName, item.link, publishedAt));
            }
          }
        }
        await setCache(feedKey, items, CACHE_TTL, FEED_RETENTION_MS);
        health[healthKey(feed.sourceName)] = 'ok';
        return items;
      } catch {
        // A feed that drops out must not swing every market's reading: keep its
        // last successful stories, which still age out through the news half-life.
        degraded = true;
        health[healthKey(feed.sourceName)] = 'failed';
        const last = await getCacheEntry<MacroEvent[]>(feedKey);
        return Array.isArray(last?.data) ? last.data : [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value);
    }
  }

  await setCache(HEALTH_KEY, health, CACHE_TTL, FEED_RETENTION_MS);
  await setCache(cacheKey, allEvents, degraded ? DEGRADED_TTL : CACHE_TTL);
  return allEvents;
}
