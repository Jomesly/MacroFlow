-- Apply after schema.sql, journal-autosync.sql and signup-login.sql.
-- Additive and rerunnable. Browser roles have no direct journal access.
begin;

create table if not exists public.journal_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_name text check (broker_name is null or length(trim(broker_name)) between 1 and 80),
  account_number text check (account_number is null or length(trim(account_number)) between 1 and 64),
  nickname text check (nickname is null or length(trim(nickname)) between 1 and 60),
  server text check (server is null or length(trim(server)) between 1 and 128),
  currency text check (currency is null or currency ~ '^[A-Z][A-Z0-9]{2,7}$'),
  broker_account_id bigint unique,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, id),
  check (is_default or (broker_name is not null and account_number is not null))
);
create unique index if not exists journal_accounts_default_idx
  on public.journal_accounts(user_id) where is_default;
create unique index if not exists journal_accounts_identity_idx
  on public.journal_accounts(user_id, lower(trim(broker_name)), lower(trim(account_number)), lower(coalesce(trim(server), '')))
  where not is_default;

-- Composite foreign keys prevent connecting another user's broker or journal.
create unique index if not exists broker_accounts_owner_id_idx on public.broker_accounts(user_id, id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'journal_accounts_broker_owner_fk' and conrelid = 'public.journal_accounts'::regclass) then
    alter table public.journal_accounts add constraint journal_accounts_broker_owner_fk
      foreign key (user_id, broker_account_id) references public.broker_accounts(user_id, id);
  end if;
end $$;

create or replace function public.prepare_broker_journal_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_broker_journal_account(new.user_id, new.id);
  return new;
end $$;
drop trigger if exists prepare_broker_journal_account on public.broker_accounts;
create trigger prepare_broker_journal_account after insert on public.broker_accounts
  for each row execute function public.prepare_broker_journal_account();
alter table public.trades add column if not exists journal_account_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trades_journal_owner_fk' and conrelid = 'public.trades'::regclass) then
    alter table public.trades add constraint trades_journal_owner_fk
      foreign key (user_id, journal_account_id) references public.journal_accounts(user_id, id);
  end if;
end $$;

-- Called by broker ingestion and backfill. Never changes a user's nickname.
create or replace function public.ensure_broker_journal_account(p_user uuid, p_broker bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid; broker public.broker_accounts%rowtype;
begin
  select * into strict broker from public.broker_accounts where id = p_broker and user_id = p_user;
  -- Serialize creation for one broker identity, including concurrent EA requests.
  perform pg_advisory_xact_lock(p_broker);
  select id into account_id from public.journal_accounts where user_id = p_user and broker_account_id = p_broker;
  if account_id is null then
    insert into public.journal_accounts(user_id, broker_name, account_number, server, currency, broker_account_id)
      values(p_user, left(broker.server, 80), broker.account_login, broker.server,
        case when upper(broker.currency) ~ '^[A-Z][A-Z0-9]{2,7}$' then upper(broker.currency) else null end, p_broker)
      returning id into account_id;
  elsif upper(broker.currency) ~ '^[A-Z][A-Z0-9]{2,7}$' then
    update public.journal_accounts set currency = upper(broker.currency), updated_at = now()
      where id = account_id and currency is null;
  end if;
  return account_id;
end $$;

create or replace function public.assign_trade_journal_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare account_id uuid;
begin
  if new.broker_account_id is not null then
    account_id := public.ensure_broker_journal_account(new.user_id, new.broker_account_id);
    if new.journal_account_id is not null and new.journal_account_id <> account_id then
      raise exception 'Trade and broker account do not match';
    end if;
    new.journal_account_id := account_id;
  elsif new.journal_account_id is null then
    -- Compatibility for old API clients; these writes always go to My journal.
    insert into public.journal_accounts(user_id, nickname, is_default)
      values(new.user_id, 'My journal', true)
      on conflict(user_id) where is_default do update set user_id = excluded.user_id
      returning id into new.journal_account_id;
  end if;
  return new;
end $$;
drop trigger if exists assign_trade_journal_account on public.trades;
create trigger assign_trade_journal_account before insert or update of user_id, broker_account_id, journal_account_id
  on public.trades for each row execute function public.assign_trade_journal_account();

-- No synthetic broker login is introduced for legacy manual trades.
select public.ensure_broker_journal_account(user_id, id) from public.broker_accounts;
update public.trades set journal_account_id = null where journal_account_id is null;
alter table public.trades alter column journal_account_id set not null;
create index if not exists trades_journal_account_date_idx
  on public.trades(user_id, journal_account_id, logged_at desc);

alter table public.journal_accounts enable row level security;
revoke all on public.journal_accounts from anon, authenticated;
grant all on public.journal_accounts to service_role;
revoke all on function public.ensure_broker_journal_account(uuid, bigint) from public, anon, authenticated;
revoke all on function public.assign_trade_journal_account() from public, anon, authenticated;
revoke all on function public.prepare_broker_journal_account() from public, anon, authenticated;
grant execute on function public.ensure_broker_journal_account(uuid, bigint) to service_role;
commit;
