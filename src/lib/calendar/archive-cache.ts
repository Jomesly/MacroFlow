import { createHash } from 'node:crypto';
import type { CalendarEvent } from '../types';
import { getCached, setCache } from '../api/cache';
import { archiveForecasts, type ArchivedForecast, type ForecastArchive } from './archive';

const TTL_MS = 60_000;
interface StoredArchive { forecasts: [string, ArchivedForecast][]; expiresAt: number }
let recent: { key: string; expiresAt: number; result: ForecastArchive } | undefined;
const pending = new Map<string, Promise<ForecastArchive>>();

/** Share archive work across dashboard callers. Failed attempts are retried, never cached. */
export async function getArchivedForecasts(events: CalendarEvent[]): Promise<ForecastArchive> {
  const digest = createHash('sha256').update(JSON.stringify(events)).digest('hex');
  const key = `calendar_archive_v2:${digest}`;
  if (recent?.key === key && recent.expiresAt > Date.now()) return recent.result;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const cached = await getCached<StoredArchive>(key);
    const usable = cached && Array.isArray(cached.forecasts) && cached.expiresAt > Date.now();
    const result: ForecastArchive = usable
      ? { forecasts: new Map(cached.forecasts), status: 'ok' }
      : await archiveForecasts(events);
    if (result.status === 'ok') {
      const expiresAt = usable ? cached.expiresAt : Date.now() + TTL_MS;
      recent = { key, result, expiresAt };
      if (!usable) await setCache(key, { forecasts: [...result.forecasts], expiresAt }, TTL_MS);
    }
    return result;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
