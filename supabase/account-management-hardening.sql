-- Apply AFTER account-management.sql. Forward-only, rerunnable hardening migration.
-- Short lock timeout fails the entire migration instead of waiting behind live writes.
begin;
set local lock_timeout = '5s';

alter table public.broker_accounts
  add column if not exists management_version integer not null default 1 check (management_version > 0),
  add column if not exists last_operation_id uuid,
  add column if not exists last_operation_request jsonb,
  add column if not exists last_operation_result jsonb;

-- RPCs acquire the owner lock BEFORE touching rows. Older/direct writers may
-- already hold a row lock when this trigger runs: never wait on an owner lock
-- from here, because that would invert the RPC lock order and deadlock.
create or replace function public.guard_journal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_state text; v_account_owner uuid;
  v_management boolean := coalesce(current_setting('macroflow.account_management', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'profiles' then v_owner := old.id; else v_owner := old.user_id; end if;
    -- Auth cascades run after the parent identity is gone in this transaction.
    if not exists (select 1 from auth.users where id = v_owner) then return old; end if;
  else
    if tg_table_name = 'profiles' then v_owner := new.id; else v_owner := new.user_id; end if;
    if tg_op = 'UPDATE' then
      if (tg_table_name = 'profiles' and to_jsonb(new)->'id' is distinct from to_jsonb(old)->'id')
        or (tg_table_name <> 'profiles' and to_jsonb(new)->'user_id' is distinct from to_jsonb(old)->'user_id') then
        raise exception 'JOURNAL_OWNER_IMMUTABLE';
      end if;
    end if;
  end if;
  -- Legacy nullable ownership is preserved, never inferred.
  if v_owner is not null then
    if not pg_try_advisory_xact_lock(hashtextextended(v_owner::text, 731)) then
      raise exception 'JOURNAL_WRITE_BUSY' using errcode = '55P03';
    end if;
    perform public.lock_journal_owner(v_owner);
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if tg_table_name = 'broker_accounts' then
    if tg_op = 'INSERT' then
      select lifecycle into v_state from public.broker_accounts
        where user_id = v_owner and server = new.server and account_login = new.account_login;
    else
      v_state := old.lifecycle;
      if not v_management and (new.lifecycle is distinct from old.lifecycle
          or new.management_version is distinct from old.management_version) then
        raise exception 'ACCOUNT_LIFECYCLE_WRITE_REQUIRES_RPC';
      end if;
    end if;
    if not v_management and v_state in ('paused', 'removed') then
      if v_state = 'removed' then raise exception 'ACCOUNT_REMOVED'; else raise exception 'ACCOUNT_PAUSED'; end if;
    end if;
  elsif tg_table_name = 'trades' then
    if new.broker_account_id is null then return new; end if;
    select user_id, lifecycle into v_account_owner, v_state from public.broker_accounts where id = new.broker_account_id;
    if v_account_owner is distinct from v_owner then raise exception 'ACCOUNT_NOT_FOUND'; end if;
    -- User edits to retained history go through write_journal_trade. Old EA
    -- upserts, including INSERT ... ON CONFLICT, cannot bypass lifecycle state.
    if v_state in ('paused', 'removed') and not (
      tg_op = 'UPDATE' and coalesce(current_setting('macroflow.trade_edit', true), '') = '1'
    ) then
      if v_state = 'removed' then raise exception 'ACCOUNT_REMOVED'; else raise exception 'ACCOUNT_PAUSED'; end if;
    end if;
  end if;
  return new;
end;
$$;

do $$ declare v_table text; begin
  foreach v_table in array array['trades','broker_accounts','broker_connections','journal_api_keys','profiles'] loop
    execute format('drop trigger if exists guard_account_deletion on public.%I', v_table);
    execute format('create trigger guard_account_deletion before insert or update or delete on public.%I for each row execute function public.guard_journal_write()', v_table);
  end loop;
end $$;

create or replace function public.list_managed_broker_accounts(p_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.last_seen_at desc nulls last, a.id), '[]'::jsonb)
  from (
    select b.id, b.account_login, b.server, b.currency, b.source, b.ea_version,
      b.last_seen_at, b.display_name, b.notes, b.lifecycle, b.removed_at, b.management_version,
      (select count(*) from public.trades t where t.user_id = p_user_id and t.broker_account_id = b.id) as trade_count
    from public.broker_accounts b where b.user_id = p_user_id
  ) a;
$$;

-- Old feature clients do not carry a version. Fail closed rather than allow
-- them to purge a reconnected account. Keep the signature for a clear error.
create or replace function public.manage_broker_account(
  p_user_id uuid, p_account_id bigint, p_action text,
  p_display_name text default null, p_notes text default '',
  p_delete_trades boolean default false, p_confirmation text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin raise exception 'ACCOUNT_CLIENT_OUTDATED'; end;
$$;

create or replace function public.manage_broker_account_v2(
  p_user_id uuid, p_account_id bigint, p_action text, p_expected_version integer, p_operation_id uuid,
  p_display_name text default null, p_notes text default '',
  p_delete_trades boolean default false, p_confirmation text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.broker_accounts; v_deleted bigint := 0; v_request jsonb; v_result jsonb;
  v_previous text := current_setting('macroflow.account_management', true);
begin
  perform public.lock_journal_owner(p_user_id);
  select * into v_account from public.broker_accounts where id = p_account_id and user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_operation_id is null or p_expected_version is null or p_expected_version < 1 then raise exception 'ACCOUNT_CLIENT_OUTDATED'; end if;
  if p_action not in ('edit','pause','resume','remove','reconnect') or p_action is null then raise exception 'INVALID_ACCOUNT_ACTION'; end if;
  v_request := jsonb_build_object('action', p_action, 'version', p_expected_version) || case
    when p_action = 'edit' then jsonb_build_object('name', p_display_name, 'notes', p_notes)
    when p_action = 'remove' then jsonb_build_object('deleteTrades', p_delete_trades, 'confirmation', p_confirmation)
    else '{}'::jsonb end;
  if v_account.last_operation_id = p_operation_id then
    if v_account.last_operation_request is distinct from v_request then raise exception 'ACCOUNT_OPERATION_CONFLICT'; end if;
    return v_account.last_operation_result;
  end if;
  if v_account.management_version <> p_expected_version then raise exception 'ACCOUNT_STATE_CHANGED'; end if;
  perform set_config('macroflow.account_management', '1', true);
  if p_action = 'remove' then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_STATE_CHANGED'; end if;
    if p_delete_trades then
      if p_confirmation is distinct from v_account.account_login then raise exception 'CONFIRMATION_REQUIRED'; end if;
      delete from public.trades where user_id = p_user_id and broker_account_id = p_account_id;
      get diagnostics v_deleted = row_count;
    end if;
    update public.broker_accounts set lifecycle = 'removed', removed_at = now(),
      display_name = null, notes = '', currency = null, ea_version = null, last_seen_at = null
      where id = p_account_id and user_id = p_user_id;
  elsif p_action = 'reconnect' then
    if v_account.lifecycle <> 'removed' then raise exception 'ACCOUNT_STATE_CHANGED'; end if;
    update public.broker_accounts set lifecycle = 'active', removed_at = null where id = p_account_id and user_id = p_user_id;
  elsif p_action = 'edit' then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED'; end if;
    if char_length(p_display_name) > 80 or char_length(p_notes) > 1000 then raise exception 'INVALID_ACCOUNT_DETAILS'; end if;
    update public.broker_accounts set display_name = nullif(btrim(p_display_name), ''), notes = coalesce(p_notes, '')
      where id = p_account_id and user_id = p_user_id;
  else
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED'; end if;
    update public.broker_accounts set lifecycle = case when p_action = 'pause' then 'paused' else 'active' end
      where id = p_account_id and user_id = p_user_id;
  end if;
  v_result := jsonb_build_object('ok', true, 'deletedTrades', v_deleted, 'managementVersion', v_account.management_version + 1);
  update public.broker_accounts set management_version = v_account.management_version + 1, updated_at = now(),
    last_operation_id = p_operation_id, last_operation_request = v_request, last_operation_result = v_result
    where id = p_account_id and user_id = p_user_id;
  perform set_config('macroflow.account_management', coalesce(v_previous, ''), true);
  return v_result;
end;
$$;

-- Normal trade writes take the same lock as ingestion before selecting/updating
-- a trade row. Only requested edit fields change; concurrent sync values survive.
create or replace function public.write_journal_trade(
  p_user_id uuid, p_action text, p_trade_id uuid, p_values jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_trade public.trades; v_previous text := current_setting('macroflow.trade_edit', true);
begin
  perform public.lock_journal_owner(p_user_id);
  if p_action = 'create' then
    insert into public.trades (id,user_id,symbol,direction,entry_price,exit_price,result,pnl_percent,setup_tags,notes,logged_at)
    values (p_trade_id,p_user_id,p_values->>'symbol',p_values->>'direction',(p_values->>'entry_price')::numeric,
      (p_values->>'exit_price')::numeric,p_values->>'result',(p_values->>'pnl_percent')::numeric,
      array(select jsonb_array_elements_text(coalesce(p_values->'setup_tags','[]'::jsonb))),
      coalesce(p_values->>'notes',''),coalesce((p_values->>'logged_at')::timestamptz,now())) returning * into v_trade;
  else
    select * into v_trade from public.trades where id = p_trade_id and user_id = p_user_id for update;
    if not found then return null; end if;
    if p_action = 'delete' then
      delete from public.trades where id = p_trade_id and user_id = p_user_id;
      return jsonb_build_object('id', p_trade_id);
    elsif p_action = 'update' then
      if p_values ? 'entry_price' then v_trade.entry_price := (p_values->>'entry_price')::numeric; end if;
      if p_values ? 'exit_price' then v_trade.exit_price := (p_values->>'exit_price')::numeric; end if;
      if p_values ? 'result' then v_trade.result := p_values->>'result'; end if;
      if p_values ? 'setup_tags' then v_trade.setup_tags := array(select jsonb_array_elements_text(p_values->'setup_tags')); end if;
      if p_values ? 'notes' then v_trade.notes := p_values->>'notes'; end if;
      if v_trade.exit_price is not null and v_trade.result is null then raise exception 'TRADE_RESULT_REQUIRED'; end if;
      v_trade.pnl_percent := case when v_trade.exit_price is null then null else
        round((v_trade.exit_price - v_trade.entry_price) / v_trade.entry_price * 100 * case when v_trade.direction = 'short' then -1 else 1 end, 2) end;
      perform set_config('macroflow.trade_edit', '1', true);
      update public.trades set entry_price = v_trade.entry_price, exit_price = v_trade.exit_price, result = v_trade.result,
        pnl_percent = v_trade.pnl_percent, setup_tags = v_trade.setup_tags, notes = v_trade.notes, updated_at = now()
        where id = p_trade_id and user_id = p_user_id returning * into v_trade;
      perform set_config('macroflow.trade_edit', coalesce(v_previous, ''), true);
    else raise exception 'INVALID_TRADE_ACTION'; end if;
  end if;
  return to_jsonb(v_trade);
end;
$$;

create or replace function public.save_journal_profile(p_user_id uuid, p_values jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  perform public.lock_journal_owner(p_user_id);
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;
  if p_values is not null then
    update public.profiles set display_name = nullif(p_values->>'display_name',''), reporting_timezone = p_values->>'reporting_timezone',
      onboarding_completed_at = coalesce(onboarding_completed_at,now()) where id = p_user_id;
  end if;
  select * into v_profile from public.profiles where id = p_user_id;
  return to_jsonb(v_profile);
end;
$$;

create or replace function public.manage_journal_api_key(
  p_user_id uuid, p_action text, p_key_id bigint default null, p_hash text default null, p_prefix text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key public.journal_api_keys;
begin
  perform public.lock_journal_owner(p_user_id);
  if p_action = 'create' then
    if (select count(*) from public.journal_api_keys where user_id = p_user_id and revoked_at is null) >= 3 then raise exception 'API_KEY_LIMIT'; end if;
    insert into public.journal_api_keys (user_id,key_hash,key_prefix) values (p_user_id,p_hash,p_prefix) returning * into v_key;
  elsif p_action = 'revoke' then
    update public.journal_api_keys set revoked_at = now() where id = p_key_id and user_id = p_user_id and revoked_at is null returning * into v_key;
    if not found then return null; end if;
  elsif p_action = 'touch' then
    select * into v_key from public.journal_api_keys where id = p_key_id and user_id = p_user_id and key_hash = p_hash and revoked_at is null for update;
    if not found then return null; end if;
    if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
      update public.journal_api_keys set last_used_at = now() where id = p_key_id and user_id = p_user_id;
    end if;
  else raise exception 'INVALID_KEY_ACTION'; end if;
  return jsonb_build_object('id',v_key.id,'key_prefix',v_key.key_prefix,'created_at',v_key.created_at);
end;
$$;

revoke all on function public.manage_broker_account_v2(uuid,bigint,text,integer,uuid,text,text,boolean,text),
  public.write_journal_trade(uuid,text,uuid,jsonb), public.save_journal_profile(uuid,jsonb),
  public.manage_journal_api_key(uuid,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.manage_broker_account_v2(uuid,bigint,text,integer,uuid,text,text,boolean,text),
  public.write_journal_trade(uuid,text,uuid,jsonb), public.save_journal_profile(uuid,jsonb),
  public.manage_journal_api_key(uuid,text,bigint,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
