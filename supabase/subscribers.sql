-- Phase Auth, Step 1: subscribers table + owner columns on trades/broker_connections.
-- Run once in Supabase SQL Editor. Expect: Success. No rows returned.

CREATE TABLE subscribers (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null unique,
  status              text not null default 'inactive'
                        check (status in ('active', 'inactive', 'cancelled')),
  stripe_customer_id  text,
  subscribed_at       timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id);

ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS user_id uuid references auth.users(id);

CREATE INDEX subscribers_status_idx ON subscribers (status);

-- Security: deny-all for anon/authenticated (publishable key is client-exposed).
-- Only the server-side service role reads/writes subscribers, same as trades.
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
