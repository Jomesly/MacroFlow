import { MacroEvent } from '../types';
import { classifyHeadline, createEventFromClassification } from './classifier';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://finnhub.io/api/v1';
const CACHE_KEY = 'finnhub_news';
const CACHE_TTL = 300_000;

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
  const cached = getCached<MacroEvent[]>(CACHE_KEY);
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
      const text = `${article.headline} ${article.summary}`;
      const classified = classifyHeadline(text);
      if (classified && !seen.has(classified.value + classified.category)) {
        seen.add(classified.value + classified.category);
        events.push(createEventFromClassification(classified, 'finnhub'));
      }
    }

    setCache(CACHE_KEY, events, CACHE_TTL);
    return events;
  } catch {
    return [];
  }
}
