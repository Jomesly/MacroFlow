import type { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import type { MappedTradeRow } from './ingest';

const STALE_LINK_MS = 30 * 60 * 1000;

// ── API key auth ────────────────────────────────────────────────────────

export interface AuthenticatedKey {
  keyId: number;
  userId: string;
}

export async function authenticateApiKey(
  sb: SupabaseClient,
  keyHash: string
): Promise<AuthenticatedKey | null> {
  const { data, error } = await sb
    .from('journal_api_keys')
    .select('id,user_id,revoked_at,last_used_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) throw new Error('API key storage unavailable');
  if (!data) return null;
  const row = data as { id: number; user_id: string; revoked_at: string | null; last_used_at: string | null };
  if (row.revoked_at) return null;

  // Recheck revocation and deletion under the owner lock before any key write.
  const touched = await sb.rpc('manage_journal_api_key', {
    p_user_id: row.user_id, p_action: 'touch', p_key_id: row.id, p_hash: keyHash,
  });
  if (touched.error?.message === 'ACCOUNT_DELETING') return null;
  if (touched.error) throw new Error('API key storage unavailable');
  if (!touched.data) return null;

  return { keyId: row.id, userId: row.user_id };
}

// ── Rate limiting (30 req/min per key hash) ─────────────────────────────

export async function checkIngestRateLimit(redis: Redis | null, keyHash: string): Promise<boolean> {
  if (!redis) return true; // fail open: never block syncs when Redis is down
  const key = `macroflow:ratelimit:ingest:${keyHash.slice(0, 16)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count <= 30;
  } catch {
    return true; // fail open on Redis errors
  }
}

// ── Broker accounts ─────────────────────────────────────────────────────

export interface BrokerAccountInfo {
  account_login: string;
  server: string;
  currency: string | null;
  ea_version: string;
}

export async function upsertBrokerAccount(
  sb: SupabaseClient,
  userId: string,
  info: BrokerAccountInfo
): Promise<number> {
  const { data, error } = await sb
    .from('broker_accounts')
    .upsert(
      {
        user_id: userId,
        account_login: info.account_login,
        server: info.server,
        currency: info.currency,
        source: 'ea',
        ea_version: info.ea_version,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,server,account_login' }
    )
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to upsert broker account: ${error?.message ?? 'no id returned'}`);
  }
  return (data as { id: number }).id;
}

// ── Trade upserts ───────────────────────────────────────────────────────

export async function upsertEaTrades(
  sb: SupabaseClient,
  userId: string,
  accountId: number,
  rows: MappedTradeRow[]
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const tickets = rows.map((r) => r.broker_trade_id);
  const { data: existing, error: readError } = await sb
    .from('trades')
    .select('broker_trade_id')
    .eq('user_id', userId)
    .eq('broker_account_id', accountId)
    .in('broker_trade_id', tickets);

  if (readError) throw new Error(`Failed to read existing trades: ${readError.message}`);
  const known = new Set((existing as { broker_trade_id: string }[]).map((r) => r.broker_trade_id));

  const { error: writeError } = await sb.from('trades').upsert(
    rows.map((r) => ({ user_id: userId, broker_account_id: accountId, ...r })),
    { onConflict: 'user_id,broker_account_id,broker_trade_id' }
  );
  if (writeError) throw new Error(`Failed to upsert trades: ${writeError.message}`);

  let inserted = 0;
  for (const r of rows) {
    if (known.has(r.broker_trade_id)) continue;
    inserted += 1;
  }
  return { inserted, updated: rows.length - inserted };
}

// ── Trade IDs for the bias-link step ────────────────────────────────────

export async function getTradeIdsForLinking(
  sb: SupabaseClient,
  userId: string,
  accountId: number,
  tickets: string[]
): Promise<LinkableTrade[]> {
  if (tickets.length === 0) return [];
  const { data, error } = await sb
    .from('trades')
    .select('id,symbol,logged_at')
    .eq('user_id', userId)
    .eq('broker_account_id', accountId)
    .in('broker_trade_id', tickets);

  if (error) throw new Error(`Failed to read trade ids: ${error.message}`);
  return (data ?? []) as LinkableTrade[];
}

// ── Bias linking (Phase 5 core) ─────────────────────────────────────────
// Links each trade to the latest snapshot for its symbol at or before entry.

export interface LinkableTrade {
  id: string;
  symbol: string;
  logged_at: string;
}

export async function linkTradesToSnapshots(
  sb: SupabaseClient,
  trades: LinkableTrade[]
): Promise<{ linked: number; stale: number }> {
  let linked = 0;
  let stale = 0;

  for (const trade of trades) {
    const { data, error } = await sb
      .from('bias_snapshots')
      .select('id,ts')
      .eq('symbol', trade.symbol)
      .lte('ts', trade.logged_at)
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) continue;
    const snap = data as { id: number; ts: string };
    const gapMs = new Date(trade.logged_at).getTime() - new Date(snap.ts).getTime();
    const isStale = gapMs > STALE_LINK_MS;

    const { error: updateError } = await sb
      .from('trades')
      .update({ snapshot_id: snap.id, stale_link: isStale })
      .eq('id', trade.id);

    if (updateError) continue;
    linked += 1;
    if (isStale) stale += 1;
  }

  return { linked, stale };
}
