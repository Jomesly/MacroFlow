import { MacroEvent } from '../types';
import { classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_KEY = 'finnhub_news';
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
    const url = `${BASE_URL}/news?category=general&token=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) return [];

    const data: FinnhubArticle[] = await res.json();
    if (!Array.isArray(data)) return [];

    const events: MacroEvent[] = [];
    const seen = new Set<string>();

    for (const article of data.slice(0, 30)) {
      const publishedAt = article.datetime ? new Date(article.datetime * 1000).toISOString() : undefined;
      if (publishedAt && Date.now() - new Date(publishedAt).getTime() > MAX_ARTICLE_AGE_MS) continue;

      const text = `${article.headline} ${article.summary}`;
      const classifiedList = classifyHeadline(text);
      for (const classified of classifiedList) {
        const key = `${classified.category}:${classified.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(createEventFromClassification(classified, 'finnhub', article.url, publishedAt));
        }
      }
    }

    await setCache(CACHE_KEY, events, CACHE_TTL);
    return events;
  } catch {
    return [];
  }
}
