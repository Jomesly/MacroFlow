-- Apply AFTER account-management-hardening.sql, trading-accounts.sql,
-- journal-account-funds.sql and journal-imports.sql. Forward-only and rerunnable.
-- Integrates account deletion with the current production journal features.
begin;
set local lock_timeout = '5s';

create or replace function public.run_managed_journal_rpc(p_user_id uuid, p_operation text, p_arguments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_trade public.trades; v_account public.journal_accounts;
  v_values jsonb := p_arguments->'p_values';
  v_previous text := current_setting('macroflow.trade_edit',true);
begin
  perform public.lock_journal_owner(p_user_id);
  case p_operation
    when 'create_journal_trade' then
      insert into public.trades(id,user_id,journal_account_id,symbol,direction,entry_price,exit_price,result,pnl_percent,setup_tags,notes,logged_at)
      values ((p_arguments->>'p_trade_id')::uuid,p_user_id,(v_values->>'journal_account_id')::uuid,
        v_values->>'symbol',v_values->>'direction',(v_values->>'entry_price')::numeric,
        (v_values->>'exit_price')::numeric,v_values->>'result',(v_values->>'pnl_percent')::numeric,
        array(select jsonb_array_elements_text(coalesce(v_values->'setup_tags','[]'))),
        coalesce(v_values->>'notes',''),coalesce((v_values->>'logged_at')::timestamptz,now())) returning * into v_trade;
      v_result := to_jsonb(v_trade);
    when 'create_journal_account' then
      insert into public.journal_accounts(user_id,broker_name,account_number,nickname,server,currency)
      values(p_user_id,v_values->>'broker_name',v_values->>'account_number',v_values->>'nickname',v_values->>'server',v_values->>'currency')
      returning * into v_account;
      v_result := to_jsonb(v_account);
    when 'rename_journal_account' then
      update public.journal_accounts set nickname=v_values->>'nickname',
        currency=case when v_values ? 'currency' then v_values->>'currency' else currency end, updated_at=now()
        where id=(p_arguments->>'p_account_id')::uuid and user_id=p_user_id returning * into v_account;
      if not found then raise exception using errcode='42501',message='Account not found.'; end if;
      v_result := to_jsonb(v_account);
    when 'update_journal_trade' then
      perform set_config('macroflow.trade_edit','1',true);
      v_result := public.update_journal_trade(p_user_id,(p_arguments->>'p_trade')::uuid,
        (p_arguments->>'p_version')::integer,p_arguments->'p_payload');
      perform set_config('macroflow.trade_edit',coalesce(v_previous,''),true);
    when 'create_journal_trade_batch' then
      v_result := public.create_journal_trade_batch(p_user_id,(p_arguments->>'p_request')::uuid,p_arguments->'p_payload');
    when 'mutate_journal_funds' then
      v_result := public.mutate_journal_funds(p_user_id,(p_arguments->>'p_account')::uuid,
        (p_arguments->>'p_request')::uuid,p_arguments->'p_payload');
    when 'stage_journal_import' then
      perform public.stage_journal_import(p_user_id,(p_arguments->>'p_id')::uuid,p_arguments->'p_payload');
      v_result := 'null'::jsonb;
    when 'commit_journal_import' then
      v_result := public.commit_journal_import(p_user_id,(p_arguments->>'p_batch')::uuid,
        array(select jsonb_array_elements_text(p_arguments->'p_rows'))::integer[],
        array(select jsonb_array_elements_text(p_arguments->'p_keep'))::integer[]);
    when 'undo_journal_import' then
      v_result := public.undo_journal_import(p_user_id,(p_arguments->>'p_batch')::uuid,(p_arguments->>'p_expected')::integer);
    else raise exception 'INVALID_JOURNAL_OPERATION';
  end case;
  return v_result;
end $$;
revoke all on function public.run_managed_journal_rpc(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.run_managed_journal_rpc(uuid,text,jsonb) to service_role;

-- Protect newer journal tables during a pending user deletion. Older application
-- requests fail fast on contention, rather than waiting after taking row locks.
create or replace function public.guard_extended_journal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_old_owner uuid; v_row jsonb;
begin
  v_row := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='journal_import_rows' then
    select user_id into v_owner from public.journal_import_batches where id=(v_row->>'batch_id')::uuid;
    if tg_op='DELETE' and v_owner is null then return old; end if;
    if tg_op='UPDATE' then
      select user_id into v_old_owner from public.journal_import_batches where id=old.batch_id;
    end if;
  else
    v_owner := (v_row->>'user_id')::uuid;
    if tg_op='UPDATE' then v_old_owner := old.user_id; end if;
  end if;
  if tg_op='UPDATE' and v_owner is distinct from v_old_owner then raise exception 'JOURNAL_OWNER_IMMUTABLE'; end if;
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=v_owner) then return old; end if;
  if v_owner is null then raise exception 'UNAUTHORIZED'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(v_owner::text,731)) then
    raise exception 'JOURNAL_WRITE_BUSY' using errcode='55P03';
  end if;
  perform public.lock_journal_owner(v_owner);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_extended_journal_write() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['journal_accounts','journal_trade_groups','journal_account_funds',
    'journal_cash_entries','journal_fund_revisions','journal_fund_requests','journal_trade_revisions',
    'journal_import_batches','journal_import_rows','journal_setup_tags'] loop
    execute format('drop trigger if exists guard_account_deletion on public.%I',t);
    execute format('create trigger guard_account_deletion before insert or update or delete on public.%I for each row execute function public.guard_extended_journal_write()',t);
  end loop;
end $$;

-- Auth cascades must not recreate an audit record referencing the deleted owner.
create or replace function public.audit_journal_trade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    insert into public.journal_trade_revisions(user_id, account_id, trade_id, operation, before_state, after_state)
      values(old.user_id, old.journal_account_id, old.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.journal_trade_revisions(user_id, account_id, trade_id, operation, before_state)
      values(old.user_id, old.journal_account_id, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
  return new;
end $$;
revoke all on function public.audit_journal_trade() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
