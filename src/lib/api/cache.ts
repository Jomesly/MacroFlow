import { Redis } from '@upstash/redis';

export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
}

const memory = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 200;
const PREFIX = 'macroflow:cache:v2:';

function createClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

function remember(key: string, entry: CacheEntry<unknown>) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
}

function isEntry(value: unknown): value is CacheEntry<unknown> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry<unknown>>;
  return 'data' in entry && Number.isFinite(entry.fetchedAt)
    && Number.isFinite(entry.freshUntil) && Number.isFinite(entry.staleUntil)
    && entry.fetchedAt! <= entry.freshUntil! && entry.freshUntil! <= entry.staleUntil!;
}

/** Read last-known data without extending its original freshness or retention. */
export async function getCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  let entry: unknown = memory.get(key);
  if (!isEntry(entry) || Date.now() >= entry.freshUntil) {
    const redis = createClient();
    if (redis) {
      try {
        const shared = await redis.get<unknown>(`${PREFIX}${key}`);
        if (isEntry(shared)) entry = shared;
      } catch { /* Retain the bounded local copy when Redis is unavailable. */ }
    }
  }
  if (!isEntry(entry) || Date.now() >= entry.staleUntil) {
    memory.delete(key);
    return null;
  }
  remember(key, entry);
  return entry as CacheEntry<T>;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const entry = await getCacheEntry<T>(key);
  return entry && Date.now() < entry.freshUntil ? entry.data : null;
}

/** maxAgeMs includes the fresh window; Redis physically expires retained data. */
export async function setCache<T>(key: string, data: T, ttlMs: number, maxAgeMs = ttlMs): Promise<CacheEntry<T> | null> {
  if (ttlMs <= 0 || maxAgeMs < ttlMs) return null;
  const now = Date.now();
  const entry: CacheEntry<T> = { data, fetchedAt: now, freshUntil: now + ttlMs, staleUntil: now + maxAgeMs };
  remember(key, entry);
  const redis = createClient();
  if (redis) {
    try { await redis.set(`${PREFIX}${key}`, entry, { px: maxAgeMs }); }
    catch { /* Process-local caching still bounds provider traffic. */ }
  }
  return entry;
}

/** Concurrent callers in this process share one refresh, including failures. */
export async function coalesce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const task = Promise.resolve().then(load);
  pending.set(key, task);
  try { return await task; }
  finally { if (pending.get(key) === task) pending.delete(key); }
}

/** A short shared lease limits refresh fan-out across server instances. */
export async function acquireRefreshLease(key: string): Promise<null | (() => Promise<void>)> {
  const redis = createClient();
  if (!redis) return async () => {};
  const token = crypto.randomUUID();
  const lockKey = `${PREFIX}lease:${key}`;
  try {
    const acquired = await redis.set(lockKey, token, { nx: true, px: 15_000 });
    if (!acquired) return null;
    return async () => {
      try {
        await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lockKey], [token]);
      } catch { /* The lease expires independently if release fails. */ }
    };
  } catch {
    // Redis failure must not make otherwise reachable providers unavailable.
    return async () => {};
  }
}
