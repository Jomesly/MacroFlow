import type { MacroEvent, MacroContext, SourceHealth, UpcomingEvent } from '../types';
import { z } from 'zod';
import { unknownContext } from '../macro-context';
import { fetchNews } from './finnhub';
import { fetchMarketData } from './twelvedata';
import { fetchRssFeeds } from './rss';
import { fetchFredInputs } from './fred';
import { getCalendar, nextHighEvent } from '../calendar';
import { coalesce, getCacheEntry, setCache } from './cache';

const CACHE_KEY = 'merged_events_v12_market_forecast';
const eventSchema = z.object({
  id: z.string().min(1), category: z.enum(['fed_tone', 'boe_tone', 'ecb_tone', 'boj_tone', 'snb_tone', 'rba_tone', 'boc_tone', 'rbnz_tone', 'inflation', 'employment', 'gdp', 'pmi', 'retail_sales', 'geopolitical', 'risk_sentiment', 'dollar_strength', 'yields', 'crypto_regulation', 'earnings', 'yen_strength', 'asset_sentiment', 'price_momentum', 'other']),
  title: z.string(), description: z.string(), timestamp: z.iso.datetime(),
  impact: z.enum(['high', 'medium', 'low']), value: z.string(),
  symbol: z.enum(['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD', 'US500', 'EURUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']).optional(),
  marketMove: z.object({ ticker: z.string(), proxy: z.boolean(), price: z.number().finite().positive(), previousClose: z.number().finite().positive(), sessionChangePercent: z.number().finite(), recentChangePercent: z.number().finite().nullable() }).optional(),
  country: z.string().optional(), url: z.string().optional(), sourceName: z.string().optional(),
  evidenceType: z.enum(['headline', 'surprise', 'trend', 'market']).optional(),
  seriesId: z.string().optional(), observationDate: z.string().optional(), expiresAt: z.iso.datetime().optional(),
  releaseEvidence: z.object({ actual: z.number(), estimate: z.number(), consensusFirstSeenAt: z.iso.datetime(), releasedAt: z.iso.datetime() }).optional(),
});
const contextSchema = z.object({
  asOf: z.iso.datetime(), regime: z.enum(['rates_sensitive', 'growth_sensitive', 'mixed', 'unknown']),
  rateSpread: z.number().nullable(), rateObservationDate: z.string().nullable(),
  inflation: z.enum(['accelerating', 'cooling', 'stable', 'unknown']), growth: z.enum(['expanding', 'contracting', 'unknown']),
  labor: z.enum(['improving', 'weakening', 'mixed', 'unknown']), complete: z.boolean(), reasons: z.array(z.string()),
});
const calendarEvidenceSchema = z.object({
  fetchedAt: z.iso.datetime(), archiveStatus: z.enum(['ok', 'failed']),
  events: z.array(z.object({ id: z.string(), title: z.string(), currency: z.string(), time: z.string(),
    impact: z.enum(['high', 'medium', 'low', 'holiday']), forecast: z.string().nullable(), actual: z.string().nullable(), previous: z.string().nullable(), affects: z.array(z.string()) })),
  archivedForecasts: z.array(z.tuple([z.string(), z.object({ forecast: z.string(), firstSeenAt: z.iso.datetime() })])),
});
const cachedEventsSchema = z.object({
  events: z.array(eventSchema), context: contextSchema, cachedAt: z.iso.datetime(),
  sourceHealth: z.record(z.string(), z.enum(['ok', 'empty', 'failed'])),
  calendarEvidence: calendarEvidenceSchema.optional(),
  nextEvent: z.object({ name: z.string(), country: z.string(), date: z.iso.datetime(), impact: z.enum(['high', 'medium']), affects: z.array(z.string()) }).nullable(),
});

interface CachedEvents {
  events: MacroEvent[];
  context: MacroContext;
  cachedAt: string;
  sourceHealth: SourceHealth;
  nextEvent: UpcomingEvent | null;
  calendarEvidence?: z.infer<typeof calendarEvidenceSchema>;
}

export async function fetchAllEvents(): Promise<CachedEvents & { stale?: boolean }> {
  return coalesce(CACHE_KEY, async () => {
  const entry = await getCacheEntry<unknown>(CACHE_KEY);
  const parsed = cachedEventsSchema.safeParse(entry?.data);
  const cached = parsed.success ? parsed.data : null;
  if (cached && entry && Date.now() < entry.freshUntil) return cached;
  const asOf = new Date().toISOString();
  const names = ['finnhub', 'market_data', 'rss'] as const;
  const [rawResults, fred, calendar] = await Promise.all([
    Promise.allSettled([fetchNews(), fetchMarketData(), fetchRssFeeds()]),
    fetchFredInputs(asOf).catch(() => ({ context: unknownContext(asOf), events: [] as MacroEvent[], failed: true })),
    getCalendar(asOf).catch(() => null),
  ]);
  const results = rawResults.map(result => {
    if (result.status === 'rejected') return result;
    const valid = z.array(eventSchema).safeParse(result.value);
    return valid.success ? { status: 'fulfilled' as const, value: valid.data }
      : { status: 'rejected' as const, reason: new Error('Invalid provider events') };
  });
  const events: MacroEvent[] = [...fred.events];
  const sourceHealth: SourceHealth = {};
  results.forEach((result, index) => {
    sourceHealth[names[index]] = result.status === 'rejected' ? 'failed' : result.value.length ? 'ok' : 'empty';
    if (result.status === 'fulfilled') events.push(...result.value);
  });
  sourceHealth.fred = fred.failed ? 'failed' : fred.context.complete ? 'ok' : 'empty';
  sourceHealth.calendar_archive = calendar?.archiveStatus ?? 'failed';
  sourceHealth.economic_calendar = !calendar || calendar.archiveStatus === 'failed' ? 'failed' : calendar.surprises.length ? 'ok' : 'empty';
  if (calendar && calendar.archiveStatus === 'ok') events.push(...calendar.surprises);
  const nextEvent = nextHighEvent(calendar?.events ?? [], asOf);
  if (!events.length && cached) {
    return { ...cached, events: cached.events.filter(event => sourceHealth.calendar_archive !== 'failed'
      || event.sourceName !== 'ForexFactory + FRED' || event.evidenceType !== 'surprise'),
      sourceHealth, nextEvent, stale: true };
  }
  const data: CachedEvents = { events: [...new Map(events.map(event => [event.id, event])).values()], context: fred.context, cachedAt: asOf, sourceHealth, nextEvent,
    calendarEvidence: calendar ? { fetchedAt: calendar.fetchedAt, archiveStatus: calendar.archiveStatus, events: calendar.events, archivedForecasts: calendar.archivedForecasts ?? [] } : undefined };
  if (data.events.length) await setCache(CACHE_KEY, data, 60_000, 3_600_000);
  return data;
  });
}
