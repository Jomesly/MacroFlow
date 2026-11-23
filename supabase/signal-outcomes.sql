-- MacroFlow signal track record: every A/B signal and how it turned out four hours later.
-- Run once in the Supabase SQL Editor. Idempotent (if not exists). No migration needed.
-- Written only by /api/signals/run (service role); read by /api/signals/track-record.
-- Outcome rule (docs/macro-probability.md): enter at the first hourly open after the signal,
-- exit at the close four contiguous hourly bars later; a flat result is a loss; missing bars are void.

create table if not exists signal_outcomes (
  id               text primary key,          -- SYMBOL:YYYY-MM-DDTHH (hour bucket of issued_at)
  symbol           text not null,
  side             text not null check (side in ('long', 'short')),
  grade            text not null check (grade in ('A', 'B')),
  forecast_version text not null,
  bias_score       integer not null,
  issued_at        timestamptz not null,
  checks           jsonb not null,
  outcome          text not null default 'open' check (outcome in ('open', 'win', 'loss', 'void')),
  entry_at         timestamptz,
  exit_at          timestamptz,
  entry_price      double precision,
  exit_price       double precision,
  return_bps       double precision,
  created_at       timestamptz not null default now()
);

create index if not exists signal_outcomes_open_idx on signal_outcomes (outcome, issued_at);
create index if not exists signal_outcomes_version_idx on signal_outcomes (forecast_version, outcome);

-- Server-only table: RLS on with no public policies; the service role bypasses RLS.
alter table signal_outcomes enable row level security;
