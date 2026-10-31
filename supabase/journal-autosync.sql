-- MacroFlow Journal Auto-Sync — Phase 4.1 schema
-- Run once in the Supabase SQL Editor. Idempotent (if not exists / drop-if-exists).
-- Prereq: Phase 4.0 (trades.user_id backfilled + NOT NULL).

-- ── Minimal bias_snapshots (populated by the Phase 3 cron) ─────────────
-- Only the PK + lookup columns are needed now so trades.snapshot_id has a
-- valid FK target. The cron will fill the remaining columns.
create table if not exists bias_snapshots (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  symbol          text not null,
  direction       text not null,
  conviction      text not null,
  score           numeric not null,
  drivers         jsonb,
  result          jsonb,
  unique (symbol, ts)
);
create index if not exists bias_snapshots_symbol_ts_idx
  on bias_snapshots (symbol, ts desc);

-- ── EA API keys ─────────────────────────────────────────────────────────
create table if not exists journal_api_keys (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  key_hash        text not null unique,   -- sha256 of the raw key
  key_prefix      text not null,          -- first 8 chars, for display
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
create index if not exists journal_api_keys_user_idx on journal_api_keys (user_id);

-- ── Connected broker accounts (one row per user + server + login) ───────
create table if not exists broker_accounts (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_login   text not null,
  server          text not null,
  currency        text,
  source          text not null default 'ea',
  ea_version      text,
  last_seen_at    timestamptz,
  unique (user_id, server, account_login)
);

-- ── Extend trades (EA / statement / future MetaApi fields) ──────────────
alter table trades
  add column if not exists broker_account_id bigint references broker_accounts(id),
  add column if not exists commission numeric,
  add column if not exists swap numeric,
  add column if not exists sl numeric,
  add column if not exists tp numeric,
  add column if not exists volume numeric,
  add column if not exists risk_amount numeric,
  add column if not exists r_multiple numeric,
  add column if not exists snapshot_id bigint references bias_snapshots(id),
  add column if not exists stale_link boolean not null default false;

-- Replace the global (source, broker_trade_id) dedupe with a
-- per-user + per-account constraint so upserts never collide across users.
drop index if exists trades_source_broker_trade_id_key;
alter table trades
  drop constraint if exists trades_user_account_ticket_unique;
alter table trades
  add constraint trades_user_account_ticket_unique
  unique (user_id, broker_account_id, broker_trade_id);

create index if not exists trades_snapshot_idx
  on trades (snapshot_id) where snapshot_id is not null;

-- ── RLS: deny-all (service-role server access only, same as trades) ─────
alter table journal_api_keys enable row level security;
alter table broker_accounts enable row level security;
alter table bias_snapshots enable row level security;
