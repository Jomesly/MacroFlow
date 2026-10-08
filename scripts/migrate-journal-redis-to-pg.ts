/**
 * One-time backfill: Redis journal keys -> Supabase `trades` table.
 *
 * Reads `macroflow:journal:trade_ids` + `macroflow:journal:trade:{id}` from
 * Upstash Redis and inserts each trade into Postgres, keeping the original
 * trade id. Already-migrated ids are skipped, so the script is safe to re-run.
 * Redis journal keys are left untouched (Redis stays bias-cache only).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UPSTASH_REDIS_REST_URL,
 * UPSTASH_REDIS_REST_TOKEN (loaded from .env.local automatically).
 *
 * Usage: npx tsx scripts/migrate-journal-redis-to-pg.ts
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Trade } from '../src/lib/types';

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function toRow(trade: Trade): Record<string, unknown> {
  return {
    id: trade.id,
    source: 'manual',
    symbol: trade.symbol,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    result: trade.result,
    pnl_percent: trade.pnlPercent,
    setup_tags: trade.setupTags,
    notes: trade.notes,
    logged_at: trade.timestamp,
  };
}

async function main(): Promise<void> {
  loadEnvLocal();

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.error('Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — cannot read legacy journal.');
    process.exit(1);
  }

  // Dynamic import so .env.local is loaded before supabase.ts evaluates.
  const [{ supabase }, { Redis }] = await Promise.all([
    import('../src/lib/supabase'),
    import('@upstash/redis'),
  ]);

  const redis = new Redis({ url: redisUrl, token: redisToken });

  const ids = await redis.lrange<string>('macroflow:journal:trade_ids', 0, -1);
  console.log(`Found ${ids.length} trade id(s) in Redis journal.`);

  if (ids.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  const { data: existingRows, error: readError } = await supabase
    .from('trades')
    .select('id');
  if (readError) {
    console.error(`Failed to read existing trades (did you run supabase/schema.sql?): ${readError.message}`);
    process.exit(1);
  }
  const existingIds = new Set((existingRows ?? []).map((r: { id: string }) => r.id));

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    if (existingIds.has(id)) {
      skipped += 1;
      continue;
    }

    const raw = await redis.get<Trade>(`macroflow:journal:trade:${id}`);
    if (!raw || typeof raw !== 'object' || !('id' in raw)) {
      console.warn(`Skipping unreadable trade record: ${id}`);
      failed += 1;
      continue;
    }

    const { error } = await supabase.from('trades').insert(toRow(raw));
    if (error) {
      console.error(`Failed to insert ${id}: ${error.message}`);
      failed += 1;
      continue;
    }
    inserted += 1;
  }

  console.log('─'.repeat(50));
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (already migrated): ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
