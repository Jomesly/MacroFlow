import { MacroEvent } from '../types';
import { articleText, classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_KEY = 'finnhub_news_v10';
export const FINNHUB_CATEGORIES = ['general', 'forex', 'crypto'] as const;
const CACHE_TTL = 300_000;
const MAX_ARTICLE_AGE_MS = 48 * 60 * 60 * 1000;

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
  const cached = await getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];

  try {
    // General news alone misses most FX and crypto stories; read each desk and merge.
    const lists = await Promise.allSettled(FINNHUB_CATEGORIES.map(async category => {
      const res = await fetch(`${BASE_URL}/news?category=${category}&token=${apiKey}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Finnhub ${category} HTTP ${res.status}`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as FinnhubArticle[]).slice(0, 30) : [];
    }));
    if (lists.every(list => list.status === 'rejected')) return [];
    const articles = new Map<string, FinnhubArticle>();
    for (const list of lists) {
      if (list.status !== 'fulfilled') continue;
      for (const article of list.value) {
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

      const text = articleText(article.headline, article.summary);
      const classifiedList = classifyHeadline(text);
      for (const classified of classifiedList) {
        const key = `${article.url || article.id}:${classified.category}:${classified.value}:${classified.country ?? ''}:${classified.symbol ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(createEventFromClassification(classified, article.source || 'finnhub', article.url, publishedAt));
        }
      }
    }

    await setCache(CACHE_KEY, events, CACHE_TTL);
    return events;
  } catch {
    return [];
  }
}
