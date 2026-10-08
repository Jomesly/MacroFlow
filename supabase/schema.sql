-- MacroFlow Trading Journal — Phase A schema
-- Run once in the Supabase SQL Editor. Idempotent (if not exists).

create extension if not exists pgcrypto;

-- ── Trades ───────────────────────────────────────────────────────────
-- user_id stays nullable until Phase Auth backfills existing rows.
create table if not exists trades (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id),
  source          text not null default 'manual',
  broker_trade_id text,
  symbol          text not null,
  direction       text not null check (direction in ('long', 'short')),
  entry_price     numeric not null check (entry_price > 0),
  exit_price      numeric check (exit_price is null or exit_price > 0),
  result          text check (result is null or result in ('win', 'loss', 'breakeven')),
  pnl_percent     numeric,
  pnl_amount      numeric,
  setup_tags      text[] not null default '{}',
  notes           text not null default '',
  logged_at       timestamptz not null default now(),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Broker import dedupe: one journal row per broker trade, no SADD needed.
create unique index if not exists trades_source_broker_trade_id_key
  on trades (source, broker_trade_id)
  where broker_trade_id is not null;

create index if not exists trades_logged_at_idx on trades (logged_at desc);

-- ── Broker connections ───────────────────────────────────────────────
-- Populated from Phase B onwards (after Phase Auth creates users).
create table if not exists broker_connections (
  user_id             uuid not null references auth.users(id),
  broker              text not null,
  api_key             text not null,
  api_secret_encrypted text not null,
  account_id          text,
  status              text not null default 'connected',
  last_sync_at        timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (user_id, broker)
);

-- ── RLS: deny-all ────────────────────────────────────────────────────
-- No policies defined: anon/authenticated can read nothing.
-- All journal access goes through the service-role client server-side.
alter table trades enable row level security;
alter table broker_connections enable row level security;
