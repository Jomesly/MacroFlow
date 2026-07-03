import { Redis } from '@upstash/redis';

function createClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function getCached<T>(key: string): Promise<T | null> {
  const redis = createClient();
  if (!redis) return null;
  try {
    const entry = await redis.get<{ data: T; expiry: number }>(`macroflow:cache:${key}`);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      await redis.del(`macroflow:cache:${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const redis = createClient();
  if (!redis) return;
  try {
    await redis.set(`macroflow:cache:${key}`, { data, expiry: Date.now() + ttlMs });
  } catch {
    // non-critical
  }
}
