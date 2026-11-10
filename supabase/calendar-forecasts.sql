-- MacroFlow economic calendar: point-in-time forecast archive.
-- Run once in the Supabase SQL Editor. Idempotent (if not exists).
-- A forecast only feeds the bias if first_seen_at is earlier than the release time.
-- The app freezes the first numeric forecast under consensus-v2:<event id>.
-- Legacy unprefixed rows are retained but excluded from scoring. No migration needed.
-- Application inserts MUST omit first_seen_at and preserve existing rows on conflict.

create table if not exists calendar_forecasts (
  id            text primary key,          -- consensus-v2:currency:title:scheduled time (ISO UTC)
  title         text not null,
  currency      text not null,
  scheduled_at  timestamptz not null,
  impact        text not null check (impact in ('high', 'medium', 'low', 'holiday')),
  forecast      text,
  previous      text,
  first_seen_at timestamptz not null default now()
);

create index if not exists calendar_forecasts_scheduled_at_idx on calendar_forecasts (scheduled_at);

-- Server-only table: RLS on with no public policies; the service role bypasses RLS.
alter table calendar_forecasts enable row level security;
