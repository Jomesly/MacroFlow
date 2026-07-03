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

export async function recordDailySnapshot(symbol: string, direction: HistoryEntry['direction'], biasScore: number): Promise<void> {
  const redis = createClient();
  if (!redis) return;

  const key = `macroflow:history:${symbol}`;
  const today = todayKey();

  try {
    const existing = await redis.get<HistoryEntry[]>(key);
    const history = existing ?? [];

    if (history.length > 0 && history[history.length - 1].date === today) {
      return;
    }

    history.push({ date: today, direction, biasScore });

    while (history.length > MAX_HISTORY) {
      history.shift();
    }

    await redis.set(key, history);
  } catch {
    // non-critical
  }
}
