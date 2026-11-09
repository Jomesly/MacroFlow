import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { providerFetch } from '../market/http';
import { loadResource } from '../market/resource';
import { parseOfficialIcal } from '../market/ical';
import type { CalendarData, CalendarEvent, Resource } from '../market/types';
import type { UpcomingEvent } from '../types';

const symbols = z.enum(['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD']);
const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  currency: z.enum(['USD', 'GBP']),
  date: z.iso.datetime(),
  impact: z.enum(['high', 'medium', 'low', 'holiday']),
  forecast: z.null(),
  previous: z.null(),
  actual: z.null(),
  affects: z.array(symbols),
  sourceName: z.string(),
  sourceUrl: z.url(),
});
const sources = [
  {
    name: 'BLS',
    currency: 'USD',
    url: 'https://www.bls.gov/schedule/news_release/',
    feed: 'https://www.bls.gov/schedule/news_release/bls.ics',
  },
  {
    name: 'BEA',
    currency: 'USD',
    url: 'https://www.bea.gov/news/schedule',
    feed: 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics',
  },
  {
    name: 'ONS',
    currency: 'GBP',
    url: 'https://www.ons.gov.uk/releasecalendar',
    feed: 'https://api.beta.ons.gov.uk/v1/search/releases',
  },
] as const;
type Source = (typeof sources)[number];

/** MacroFlow editorial priority, never represented as an agency impact rating. */
function priority(
  title: string,
  source: Source['name'],
): CalendarEvent['impact'] | null {
  if (source === 'BLS') {
    if (/^(Consumer Price Index|Employment Situation)$/i.test(title))
      return 'high';
    if (
      /^(Producer Price Index|Job Openings and Labor Turnover Survey|Employment Cost Index|Productivity and Costs)/i.test(
        title,
      )
    )
      return 'medium';
  }
  if (source === 'BEA') {
    if (
      /^(Gross Domestic Product|GDP\b|Personal Income and Outlays)/i.test(title)
    )
      return 'high';
    if (
      /^(U\.S\. International Trade|International Trade in Goods)/i.test(title)
    )
      return 'medium';
  }
  if (source === 'ONS' && !/time series/i.test(title)) {
    if (
      /^(Consumer price inflation, UK|GDP (monthly estimate|first quarterly estimate|quarterly national accounts), UK|UK labour market|Labour market overview, UK)/i.test(
        title,
      )
    )
      return 'high';
    if (
      /^(Retail sales, Great Britain|Producer price inflation, UK)/i.test(title)
    )
      return 'medium';
  }
  return null;
}

function event(
  source: Source,
  uid: string,
  title: string,
  date: string,
  url = source.url as string,
): CalendarEvent | null {
  const impact = priority(title, source.name);
  if (!impact) return null;
  return {
    id: createHash('sha256')
      .update(`${source.name}|${uid}`)
      .digest('hex')
      .slice(0, 20),
    title,
    currency: source.currency,
    date,
    impact,
    forecast: null,
    previous: null,
    actual: null,
    affects:
      source.currency === 'GBP'
        ? ['GBPUSD']
        : ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'],
    sourceName: source.name,
    sourceUrl: url,
  };
}

export function normalizeOfficialIcal(
  text: string,
  name: 'BLS' | 'BEA',
): CalendarEvent[] {
  const source = sources.find((s) => s.name === name)!;
  return parseOfficialIcal(text)
    .map((row) => event(source, row.uid, row.title, row.date))
    .filter((e): e is CalendarEvent => e !== null);
}

const onsSchema = z.object({
  breakdown: z.object({ total: z.number().int().nonnegative() }),
  releases: z
    .array(
      z.object({
        uri: z
          .string()
          .regex(/^\/releases\/[a-zA-Z0-9_-]+$/)
          .max(1000),
        description: z.object({
          title: z.string().min(1).max(500),
          release_date: z.iso.datetime({ offset: true }),
          cancelled: z.boolean(),
          postponed: z.boolean(),
          finalised: z.boolean(),
        }),
      }),
    )
    .max(1000),
});

export function normalizeOns(raw: unknown): CalendarEvent[] {
  const body = onsSchema.parse(raw);
  if (body.breakdown.total > body.releases.length)
    throw new Error('Incomplete ONS calendar page');
  return body.releases
    .filter(
      (r) =>
        !r.description.cancelled &&
        !r.description.postponed &&
        r.description.finalised,
    )
    .map((r) =>
      event(
        sources[2],
        r.uri,
        r.description.title,
        new Date(r.description.release_date).toISOString(),
        `https://www.ons.gov.uk${r.uri}`,
      ),
    )
    .filter((e): e is CalendarEvent => e !== null);
}

export async function fetchCalendar(): Promise<Resource<CalendarData>> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start.getTime() + 28 * 86_400_000);
  const feeds = await Promise.all(
    sources.map((source) =>
      loadResource({
        key: `calendar:official:v1:${source.name}:${start.toISOString().slice(0, 10)}`,
        provider: source.name,
        instrumentId: 'economic-calendar',
        sourceUrl: source.url,
        ttlMs: 3_600_000,
        maxAgeMs: 86_400_000,
        schema: z.array(eventSchema),
        empty: (rows) => !rows.length,
        load: async () => {
          const url = new URL(source.feed);
          if (source.name === 'ONS')
            url.search = new URLSearchParams({
              limit: '1000',
              sort: 'release_date_asc',
              'release-type': 'type-upcoming',
              fromDate: start.toISOString().slice(0, 10),
              toDate: end.toISOString().slice(0, 10),
            }).toString();
          const response = await providerFetch(url.toString());
          const rows =
            source.name === 'ONS'
              ? normalizeOns(await response.json())
              : normalizeOfficialIcal(await response.text(), source.name);
          const unique = new Map(
            rows
              .filter(
                (e) =>
                  e.date >= start.toISOString() && e.date < end.toISOString(),
              )
              .map((e) => [e.id, e]),
          );
          return { data: [...unique.values()], observedAt: null };
        },
      }),
    ),
  );
  const available = feeds.filter((f) => f.data !== null);
  const earliest = (key: 'fetchedAt' | 'freshUntil' | 'staleUntil') =>
    available
      .map((f) => f.meta[key])
      .filter((d): d is string => d !== null)
      .sort()[0] ?? null;
  const events = available
    .flatMap((f) => f.data!)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    data: available.length
      ? {
          events,
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
          sources: feeds.map((f) => ({
            name: f.meta.provider,
            url: f.meta.sourceUrl,
            status: f.meta.status,
            fetchedAt: f.meta.fetchedAt,
          })),
        }
      : null,
    meta: {
      provider: 'BLS / BEA / ONS',
      instrumentId: 'official-economic-calendar',
      sourceUrl: 'https://www.bls.gov/schedule/news_release/',
      observedAt: null,
      fetchedAt: earliest('fetchedAt'),
      freshUntil: earliest('freshUntil'),
      staleUntil: earliest('staleUntil'),
      delayed: false,
      status: !available.length
        ? 'unavailable'
        : feeds.some((f) => ['unavailable', 'stale'].includes(f.meta.status))
          ? 'stale'
          : !events.length
            ? 'empty'
            : 'fresh',
    },
  };
}

export function nextCalendarEvent(
  calendar: Resource<CalendarData>,
  now = Date.now(),
): UpcomingEvent | null {
  if (
    !calendar.data ||
    calendar.meta.status === 'unavailable' ||
    (calendar.meta.staleUntil && Date.parse(calendar.meta.staleUntil) <= now)
  )
    return null;
  const upcoming = calendar.data.events.find(
    (e) =>
      Date.parse(e.date) > now &&
      (e.impact === 'high' || e.impact === 'medium'),
  );
  return upcoming
    ? {
        name: upcoming.title,
        country: upcoming.currency,
        date: upcoming.date,
        impact: upcoming.impact as 'high' | 'medium',
        affects: upcoming.affects,
      }
    : null;
}
