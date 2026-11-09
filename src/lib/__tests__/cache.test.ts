import { afterEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
let redisUnavailable = false;
const writes = vi.hoisted(() => vi.fn());

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    async get<T>(key: string): Promise<T | null> {
      if (redisUnavailable) throw new Error('Redis unavailable');
      return (store.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown, options: unknown): Promise<void> {
      if (redisUnavailable) throw new Error('Redis unavailable');
      writes(key, value, options);
      store.set(key, value);
    }

    async del(key: string): Promise<void> {
      store.delete(key);
    }
  },
}));

describe('cache', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); redisUnavailable = false; });
  it('round-trips cached values and expires stale entries', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    const { getCached, setCache } = await import('../api/cache');

    await setCache('roundtrip', { value: 1 }, 1000);
    await setCache('expired', { value: 2 }, -1);

    await expect(getCached<{ value: number }>('roundtrip')).resolves.toEqual({ value: 1 });
    await expect(getCached<{ value: number }>('expired')).resolves.toBeNull();
    expect(writes).toHaveBeenCalledWith('macroflow:cache:v2:roundtrip', expect.any(Object), { px: 1000 });
  });

  it('retains stale data only until its maximum age, without renewing timestamps', async () => {
    vi.useFakeTimers();
    const { getCached, getCacheEntry, setCache } = await import('../api/cache');
    await setCache('bounded-stale', { value: 3 }, 1000, 3000);
    const fresh = await getCacheEntry('bounded-stale');
    vi.advanceTimersByTime(1001);
    await expect(getCached('bounded-stale')).resolves.toBeNull();
    await expect(getCacheEntry('bounded-stale')).resolves.toEqual(fresh);
    vi.advanceTimersByTime(2000);
    await expect(getCacheEntry('bounded-stale')).resolves.toBeNull();
  });

  it('coalesces simultaneous refreshes and releases failed refreshes', async () => {
    const { coalesce } = await import('../api/cache');
    const load = vi.fn(async () => 42);
    expect(await Promise.all([coalesce('parallel', load), coalesce('parallel', load)])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(coalesce('parallel', async () => { throw new Error('failure'); })).rejects.toThrow('failure');
    await expect(coalesce('parallel', load)).resolves.toBe(42);
  });

  it('keeps bounded local recovery working when Redis fails', async () => {
    vi.useFakeTimers();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.com');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    redisUnavailable = true;
    const { getCacheEntry, getCached, setCache } = await import('../api/cache');
    await setCache('redis-outage', { value: 4 }, 1000, 2000);
    await expect(getCached('redis-outage')).resolves.toEqual({ value: 4 });
    vi.advanceTimersByTime(1001);
    expect((await getCacheEntry('redis-outage'))?.data).toEqual({ value: 4 });
    vi.advanceTimersByTime(1000);
    await expect(getCacheEntry('redis-outage')).resolves.toBeNull();
  });
});
