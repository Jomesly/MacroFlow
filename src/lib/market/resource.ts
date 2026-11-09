import 'server-only';
import { z } from 'zod';
import { acquireRefreshLease, coalesce, getCacheEntry, getCached, setCache } from '../api/cache';
import type { Resource } from './types';
import { ProviderError } from './http';

interface ResourceOptions<T> {
  key: string;
  provider: string;
  instrumentId: string;
  sourceUrl: string;
  ttlMs: number;
  maxAgeMs: number;
  delayed?: boolean;
  schema: z.ZodType<T>;
  load: () => Promise<{ data: T; observedAt: string | null }>;
  empty?: (data: T) => boolean;
}

/** Cache validated payloads; outages never renew their original timestamps. */
export async function loadResource<T>(input: ResourceOptions<T>): Promise<Resource<T>> {
  // A preview must prove its own provider access, not inherit a developer's cache.
  const scope = process.env.VERCEL_ENV === 'preview' ? `preview:${process.env.VERCEL_URL ?? 'unknown'}`
    : process.env.VERCEL_ENV === 'production' ? 'production' : 'local';
  const options = { ...input, key: `market:${scope}:${input.key}` };
  return coalesce(`resource:${options.key}`, async () => {
    const schema = z.object({ data: options.schema, observedAt: z.iso.datetime().nullable() });
    const cached = await getCacheEntry<unknown>(options.key);
    const parsed = cached ? schema.safeParse(cached.data) : null;
    const usable = cached && parsed?.success ? { entry: cached, payload: parsed.data } : null;
    const format = (status: Resource<T>['meta']['status'], value = usable): Resource<T> => ({
      data: value?.payload.data ?? null,
      meta: {
        provider: options.provider, instrumentId: options.instrumentId, sourceUrl: options.sourceUrl,
        observedAt: value?.payload.observedAt ?? null,
        fetchedAt: value ? new Date(value.entry.fetchedAt).toISOString() : null,
        freshUntil: value ? new Date(value.entry.freshUntil).toISOString() : null,
        staleUntil: value ? new Date(value.entry.staleUntil).toISOString() : null,
        status, delayed: options.delayed ?? false,
      },
    });
    if (usable && Date.now() < usable.entry.freshUntil) {
      return format(options.empty?.(usable.payload.data) ? 'empty' : 'fresh');
    }
    const fallback = () => format(usable ? 'stale' : 'unavailable');
    if (await getCached<boolean>(`${options.key}:cooldown`)) return fallback();
    const release = await acquireRefreshLease(options.key);
    if (!release) return fallback();
    try {
      const payload = schema.parse(await options.load());
      const now = Date.now();
      const stored = await setCache(options.key, payload, options.ttlMs, options.maxAgeMs);
      return format(options.empty?.(payload.data) ? 'empty' : 'fresh', {
        entry: stored ?? { data: payload, fetchedAt: now, freshUntil: now + options.ttlMs, staleUntil: now + options.maxAgeMs },
        payload,
      });
    } catch (error) {
      // Shared negative cache prevents every browser from retrying a failed feed.
      await setCache(`${options.key}:cooldown`, true, error instanceof ProviderError ? error.retryAfterMs : 60_000);
      return fallback();
    } finally {
      await release();
    }
  });
}
