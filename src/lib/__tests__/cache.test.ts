import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const setOptions = new Map<string, unknown>();

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown, options?: unknown): Promise<void> {
      store.set(key, value);
      setOptions.set(key, options);
    }

    async del(key: string): Promise<void> {
      store.delete(key);
    }
  },
}));

describe('cache', () => {
  it('round-trips cached values and expires stale entries', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    const { getCached, setCache } = await import('../api/cache');

    await setCache('roundtrip', { value: 1 }, 1000);
    await setCache('expired', { value: 2 }, -1);

    await expect(getCached<{ value: number }>('roundtrip')).resolves.toEqual({ value: 1 });
    await expect(getCached<{ value: number }>('expired')).resolves.toBeNull();
  });

  it('sets a Redis TTL so unread date-keyed entries still expire', async () => {
    const { setCache } = await import('../api/cache');
    await setCache('fred_snapshot_v3:2026-11-09', { value: 3 }, 6 * 3_600_000);
    await setCache('expired-ttl', { value: 4 }, -1);
    expect(setOptions.get('macroflow:cache:fred_snapshot_v3:2026-11-09')).toEqual({ px: 6 * 3_600_000 });
    expect(setOptions.get('macroflow:cache:expired-ttl')).toEqual({ px: 1 });
  });
});
