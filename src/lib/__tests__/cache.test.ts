import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown): Promise<void> {
      store.set(key, value);
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
});
