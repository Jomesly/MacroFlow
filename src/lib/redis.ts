import { Redis } from '@upstash/redis';
import { HistoryEntry } from './types';

function createClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const MAX_HISTORY = 7;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getHistory(symbol: string): Promise<HistoryEntry[]> {
  const redis = createClient();
  if (!redis) return [];
  try {
    const raw = await redis.get<HistoryEntry[]>(`macroflow:history:${symbol}`);
    return raw ?? [];
  } catch {
    return [];
  }
}

/** Today's entry tracks the latest read, so history always ends on the current score. */
export function upsertDailySnapshot(history: HistoryEntry[], entry: HistoryEntry, limit: number): HistoryEntry[] {
  const earlier = history.at(-1)?.date === entry.date ? history.slice(0, -1) : history;
  return [...earlier, entry].slice(-limit);
}

export async function recordDailySnapshot(symbol: string, direction: HistoryEntry['direction'], biasScore: number): Promise<void> {
  const redis = createClient();
  if (!redis) return;

  const key = `macroflow:history:${symbol}`;

  try {
    const existing = await redis.get<HistoryEntry[]>(key);
    const latest = existing?.at(-1);
    const today = todayKey();
    if (latest?.date === today && latest.biasScore === biasScore && latest.direction === direction) return;
    await redis.set(key, upsertDailySnapshot(existing ?? [], { date: today, direction, biasScore }, MAX_HISTORY));
  } catch {
    // non-critical
  }
}
