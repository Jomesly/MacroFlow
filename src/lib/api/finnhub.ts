import type { MacroEvent, SourceHealth, SourceStatus } from '../types';
import { articleText, classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, getCacheEntry, setCache } from './cache';

const BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_KEY = 'finnhub_news_v11';
const MAX_SUMMARY_CHARS = 400;
export const FINNHUB_CATEGORIES = ['general', 'forex', 'crypto'] as const;
const CACHE_TTL = 300_000;
const DEGRADED_TTL = 60_000;
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

/** Keep status beside the events it describes, including when the result is empty. */
interface CachedNews { events: MacroEvent[]; health: SourceHealth }
const deskHealth = (status: SourceStatus): SourceHealth => Object.fromEntries(
  FINNHUB_CATEGORIES.map(category => [`feed_finnhub_${category}`, status]));

/** Disabled desks are empty; configured desks without verified health are unavailable. */
export async function getFinnhubNewsHealth(): Promise<SourceHealth> {
  if (!process.env.FINNHUB_API_KEY) return deskHealth('empty');
  const entry = await getCacheEntry<CachedNews>(CACHE_KEY);
  return entry?.data?.health ?? deskHealth('failed');
}

interface FinnhubArticle {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export async function fetchNews(): Promise<MacroEvent[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];
  const cached = await getCached<CachedNews>(CACHE_KEY);
  if (cached && Array.isArray(cached.events) && cached.health) return cached.events;

  try {
    // General news alone misses most FX and crypto stories; read each desk and merge.
    const lists = await Promise.allSettled(FINNHUB_CATEGORIES.map(async category => {
      const res = await fetch(`${BASE_URL}/news?category=${category}&token=${apiKey}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Finnhub ${category} HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error(`Finnhub ${category} returned an invalid news list`);
      return (data as FinnhubArticle[]).slice(0, 30);
    }));
    const health: SourceHealth = {};
    lists.forEach((list, index) => {
      health[`feed_finnhub_${FINNHUB_CATEGORIES[index]}`] = list.status === 'rejected' ? 'failed'
        : list.value.length ? 'ok' : 'empty';
    });
    const degraded = lists.some(list => list.status === 'rejected');
    const articles = new Map<string, FinnhubArticle>();
    for (const list of lists) {
      if (list.status !== 'fulfilled') continue;
      for (const article of list.value) {
        if (!article || typeof article !== 'object') continue;
        const id = String(article.url || article.id);
        if (!articles.has(id)) articles.set(id, article);
      }
    }

    const events: MacroEvent[] = [];
    const seen = new Set<string>();

    for (const article of articles.values()) {
      const publishedMs = article.datetime * 1000;
      if (!article.datetime || !Number.isFinite(publishedMs) || publishedMs > Date.now() || Date.now() - publishedMs > MAX_ARTICLE_AGE_MS) continue;
      const publishedAt = new Date(publishedMs).toISOString();

      // Finnhub summaries can be whole articles; rules read a headline and its lead, as for RSS.
      const text = articleText(article.headline, article.summary, MAX_SUMMARY_CHARS);
      const classifiedList = classifyHeadline(text);
      for (const classified of classifiedList) {
        const key = `${article.url || article.id}:${classified.category}:${classified.value}:${classified.country ?? ''}:${classified.symbol ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(createEventFromClassification(classified, article.source || 'finnhub', article.url, publishedAt));
        }
      }
    }

    await setCache<CachedNews>(CACHE_KEY, { events, health }, degraded ? DEGRADED_TTL : CACHE_TTL);
    return events;
  } catch {
    // A transport/parsing failure must not look like a successful but quiet news feed.
    await setCache<CachedNews>(CACHE_KEY, { events: [], health: deskHealth('failed') }, DEGRADED_TTL);
    return [];
  }
}
