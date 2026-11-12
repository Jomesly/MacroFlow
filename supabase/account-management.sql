-- Apply after signup-login.sql. Additive, rerunnable account lifecycle migration.
-- Deletions performed by these functions are irreversible. Deploy this migration
-- before the application. Roll back application code only; retain lifecycle guards.
begin;

alter table public.broker_accounts
  add column if not exists display_name text check (char_length(display_name) <= 80),
  add column if not exists notes text not null default '' check (char_length(notes) <= 1000),
  add column if not exists lifecycle text not null default 'active'
    check (lifecycle in ('active', 'paused', 'removed')),
  add column if not exists removed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.journal_access add column if not exists deletion_requested_at timestamptz;

-- Auth's deleteUser deletes application data in the same database transaction.
alter table public.trades drop constraint if exists trades_user_id_fkey;
alter table public.trades add constraint trades_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.broker_connections drop constraint if exists broker_connections_user_id_fkey;
alter table public.broker_connections add constraint broker_connections_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- All account lifecycle operations and journal writes share a transaction lock.
-- A request authorized before deletion began cannot write after the freeze.
create or replace function public.lock_journal_owner(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 731));
  if exists (select 1 from public.journal_access
    where user_id = p_user_id and deletion_requested_at is not null) then
    raise exception 'ACCOUNT_DELETING';
  end if;
end;
$$;

create or replace function public.guard_journal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if tg_table_name = 'profiles' then v_owner := new.id;
  else v_owner := new.user_id; end if;
  -- Preserve nullable legacy trades; never infer an owner.
  if v_owner is not null then perform public.lock_journal_owner(v_owner); end if;
  return new;
end;
$$;

do $$ declare v_table text; begin
  foreach v_table in array array['trades','broker_accounts','broker_connections','journal_api_keys','profiles'] loop
    execute format('drop trigger if exists guard_account_deletion on public.%I', v_table);
    execute format('create trigger guard_account_deletion before insert or update on public.%I for each row execute function public.guard_journal_write()', v_table);
  end loop;
end $$;

create or replace function public.list_managed_broker_accounts(p_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.last_seen_at desc nulls last, a.id), '[]'::jsonb)
  from (
    select b.id, b.account_login, b.server, b.currency, b.source, b.ea_version,
      b.last_seen_at, b.display_name, b.notes, b.lifecycle, b.removed_at,
      (select count(*) from public.trades t where t.user_id = p_user_id and t.broker_account_id = b.id) as trade_count
    from public.broker_accounts b where b.user_id = p_user_id
  ) a;
$$;

create or replace function public.manage_broker_account(
  p_user_id uuid, p_account_id bigint, p_action text,
  p_display_name text default null, p_notes text default '',
  p_delete_trades boolean default false, p_confirmation text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.broker_accounts; v_deleted bigint := 0;
begin
  perform public.lock_journal_owner(p_user_id);
  select * into v_account from public.broker_accounts
    where id = p_account_id and user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_action = 'remove' then
    if p_delete_trades then
      if p_confirmation is distinct from v_account.account_login then raise exception 'CONFIRMATION_REQUIRED'; end if;
      delete from public.trades where user_id = p_user_id and broker_account_id = p_account_id;
      get diagnostics v_deleted = row_count;
    end if;
    -- Keep only connection identity and history linkage as a sync tombstone.
    update public.broker_accounts set lifecycle = 'removed', removed_at = coalesce(removed_at, now()),
      display_name = null, notes = '', currency = null, ea_version = null, last_seen_at = null, updated_at = now()
      where id = p_account_id and user_id = p_user_id;
  elsif p_action = 'reconnect' then
    if v_account.lifecycle <> 'removed' then raise exception 'ACCOUNT_STATE_CHANGED'; end if;
    update public.broker_accounts set lifecycle = 'active', removed_at = null, updated_at = now()
      where id = p_account_id and user_id = p_user_id;
  elsif p_action = 'edit' then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED'; end if;
    if char_length(p_display_name) > 80 or char_length(p_notes) > 1000 then raise exception 'INVALID_ACCOUNT_DETAILS'; end if;
    update public.broker_accounts set display_name = nullif(btrim(p_display_name), ''), notes = coalesce(p_notes, ''), updated_at = now()
      where id = p_account_id and user_id = p_user_id;
  elsif p_action in ('pause', 'resume') then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED'; end if;
    update public.broker_accounts set lifecycle = case when p_action = 'pause' then 'paused' else 'active' end, updated_at = now()
      where id = p_account_id and user_id = p_user_id;
  else raise exception 'INVALID_ACCOUNT_ACTION'; end if;
  return jsonb_build_object('ok', true, 'deletedTrades', v_deleted);
end;
$$;

-- Account matching and trade ingestion must be one transaction with removal.
-- This also prevents concurrent sync requests from giving inaccurate upsert counts.
create or replace function public.ingest_managed_journal(
  p_user_id uuid, p_account jsonb, p_trades jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.broker_accounts; v_row jsonb; v_existing boolean;
  v_inserted integer := 0; v_updated integer := 0; v_linked integer := 0; v_stale integer := 0;
  v_snapshot_id bigint; v_snapshot_ts timestamptz; v_is_stale boolean;
begin
  perform public.lock_journal_owner(p_user_id);
  if not exists (select 1 from public.journal_access where user_id = p_user_id and status = 'active') then
    raise exception 'JOURNAL_ACCESS_REVOKED';
  end if;
  select * into v_account from public.broker_accounts
    where user_id = p_user_id and server = p_account->>'server' and account_login = p_account->>'account_login' for update;
  if found and v_account.lifecycle <> 'active' then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED';
    else raise exception 'ACCOUNT_PAUSED'; end if;
  end if;
  insert into public.broker_accounts (user_id, account_login, server, currency, source, ea_version, last_seen_at)
    values (p_user_id, p_account->>'account_login', p_account->>'server', p_account->>'currency', 'ea', p_account->>'ea_version', now())
    on conflict (user_id, server, account_login) do update set currency = excluded.currency,
      ea_version = excluded.ea_version, last_seen_at = excluded.last_seen_at, updated_at = now()
    returning * into v_account;
  for v_row in select value from jsonb_array_elements(p_trades) loop
    select exists (select 1 from public.trades where user_id = p_user_id
      and broker_account_id = v_account.id and broker_trade_id = v_row->>'broker_trade_id') into v_existing;
    v_snapshot_id := null; v_snapshot_ts := null;
    select id, ts into v_snapshot_id, v_snapshot_ts from public.bias_snapshots
      where symbol = v_row->>'symbol' and ts <= (v_row->>'logged_at')::timestamptz order by ts desc limit 1;
    v_is_stale := coalesce((v_row->>'logged_at')::timestamptz - v_snapshot_ts > interval '30 minutes', false);
    insert into public.trades (user_id, broker_account_id, broker_trade_id, source, symbol, direction,
      entry_price, exit_price, result, pnl_amount, commission, swap, sl, tp, volume, risk_amount,
      r_multiple, logged_at, closed_at, snapshot_id, stale_link)
    values (p_user_id, v_account.id, v_row->>'broker_trade_id', 'ea', v_row->>'symbol', v_row->>'direction',
      (v_row->>'entry_price')::numeric, (v_row->>'exit_price')::numeric, v_row->>'result',
      (v_row->>'pnl_amount')::numeric, (v_row->>'commission')::numeric, (v_row->>'swap')::numeric,
      (v_row->>'sl')::numeric, (v_row->>'tp')::numeric, (v_row->>'volume')::numeric,
      (v_row->>'risk_amount')::numeric, (v_row->>'r_multiple')::numeric,
      (v_row->>'logged_at')::timestamptz, (v_row->>'closed_at')::timestamptz, v_snapshot_id, v_is_stale)
    on conflict (user_id, broker_account_id, broker_trade_id) do update set
      symbol = excluded.symbol, direction = excluded.direction, entry_price = excluded.entry_price,
      exit_price = excluded.exit_price, result = excluded.result, pnl_amount = excluded.pnl_amount,
      commission = excluded.commission, swap = excluded.swap, sl = excluded.sl, tp = excluded.tp,
      volume = excluded.volume, risk_amount = excluded.risk_amount, r_multiple = excluded.r_multiple,
      logged_at = excluded.logged_at, closed_at = excluded.closed_at,
      snapshot_id = coalesce(excluded.snapshot_id, public.trades.snapshot_id),
      stale_link = case when excluded.snapshot_id is null then public.trades.stale_link else excluded.stale_link end,
      updated_at = now();
    if v_existing then v_updated := v_updated + 1; else v_inserted := v_inserted + 1; end if;
    if v_snapshot_id is not null then
      v_linked := v_linked + 1;
      if v_is_stale then v_stale := v_stale + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'linked', v_linked, 'stale', v_stale);
end;
$$;

create or replace function public.prepare_journal_user_deletion(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 731));
  if exists (select 1 from public.journal_access where user_id = p_user_id and deletion_requested_at is not null) then return; end if;
  if exists (select 1 from public.subscribers where id = p_user_id and status = 'active' and stripe_customer_id is not null) then
    raise exception 'BILLING_REVIEW_REQUIRED';
  end if;
  update public.journal_api_keys set revoked_at = coalesce(revoked_at, now()) where user_id = p_user_id;
  insert into public.journal_access (user_id, status, deletion_requested_at) values (p_user_id, 'revoked', now())
    on conflict (user_id) do update set status = 'revoked', deletion_requested_at = now(), updated_at = now();
end;
$$;

revoke all on function public.lock_journal_owner(uuid), public.guard_journal_write(),
  public.list_managed_broker_accounts(uuid), public.manage_broker_account(uuid,bigint,text,text,text,boolean,text),
  public.ingest_managed_journal(uuid,jsonb,jsonb), public.prepare_journal_user_deletion(uuid) from public, anon, authenticated;
grant execute on function public.list_managed_broker_accounts(uuid),
  public.manage_broker_account(uuid,bigint,text,text,text,boolean,text),
  public.ingest_managed_journal(uuid,jsonb,jsonb), public.prepare_journal_user_deletion(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
