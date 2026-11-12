-- Disposable local database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
-- Convenience helper for fresh intents; replay tests below use explicit versions/IDs.
create function pg_temp.manage(p_user_id uuid, p_account_id bigint, p_action text,
  p_display_name text default null, p_notes text default '', p_delete_trades boolean default false, p_confirmation text default '')
returns jsonb language sql as $$
  select public.manage_broker_account_v2(p_user_id,p_account_id,p_action,
    coalesce((select management_version from public.broker_accounts where id=p_account_id),1),gen_random_uuid(),
    p_display_name,p_notes,p_delete_trades,p_confirmation);
$$;
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-000000000001', 'accounts-a@example.test'),
 ('a0000000-0000-0000-0000-000000000002', 'accounts-b@example.test');

do $$
declare
  u uuid := 'a0000000-0000-0000-0000-000000000001';
  other_user uuid := 'a0000000-0000-0000-0000-000000000002';
  a bigint; result jsonb; receipt jsonb; version integer; operation uuid := gen_random_uuid(); trade_id uuid;
  identity jsonb := '{"account_login":"555001","server":"Test-Broker","currency":"USD","ea_version":"test"}';
  rows jsonb := '[{"broker_trade_id":"ticket-1","symbol":"XAUUSD","direction":"long","entry_price":2600,"exit_price":2610,"result":"win","pnl_amount":10,"commission":0,"swap":0,"volume":0.1,"logged_at":"2026-11-01T12:00:00Z","closed_at":"2026-11-01T12:10:00Z"}]';
begin
  result := public.ingest_managed_journal(u, identity, rows);
  assert (result->>'inserted')::int = 1, 'first sync inserts';
  select id into a from public.broker_accounts where user_id = u;
  perform pg_temp.manage(u, a, 'edit', 'My account', 'Private notes');
  update public.trades set notes = 'Reviewed trade', setup_tags = array['breakout'] where user_id = u and broker_account_id = a;
  result := public.ingest_managed_journal(u, identity, rows);
  assert (result->>'updated')::int = 1, 'repeated sync deduplicates';
  assert (select display_name = 'My account' and notes = 'Private notes' from public.broker_accounts where id = a), 'sync overwrites preferences';
  assert (select notes = 'Reviewed trade' and setup_tags = array['breakout'] from public.trades where user_id = u and broker_account_id = a), 'sync overwrites trade annotations';
  begin
    perform pg_temp.manage(other_user, a, 'remove');
    raise exception 'cross-user removal allowed';
  exception when raise_exception then
    if sqlerrm <> 'ACCOUNT_NOT_FOUND' then raise; end if;
  end;
  perform pg_temp.manage(u, a, 'pause');
  begin
    perform public.ingest_managed_journal(u, identity, rows);
    raise exception 'paused sync allowed';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_PAUSED' then raise; end if; end;
  begin
    insert into public.broker_accounts (user_id,server,account_login,source) values (u,'Test-Broker','555001','ea')
      on conflict (user_id,server,account_login) do update set last_seen_at=now();
    raise exception 'old account upsert bypassed pause';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_PAUSED' then raise; end if; end;
  begin
    insert into public.trades (user_id,broker_account_id,broker_trade_id,source,symbol,direction,entry_price)
      values (u,a,'old-paused','ea','XAUUSD','long',2600);
    raise exception 'old trade insert bypassed pause';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_PAUSED' then raise; end if; end;
  perform pg_temp.manage(u, a, 'resume');
  perform pg_temp.manage(u, a, 'remove');
  assert (select count(*) = 1 from public.trades where user_id = u and broker_account_id = a), 'history not retained';
  assert (select lifecycle = 'removed' and notes = '' and display_name is null from public.broker_accounts where id = a), 'tombstone not scrubbed';
  begin
    perform public.ingest_managed_journal(u, identity, rows);
    raise exception 'removed account recreated';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_REMOVED' then raise; end if; end;
  begin
    insert into public.broker_accounts (user_id,server,account_login,source) values (u,'Test-Broker','555001','ea')
      on conflict (user_id,server,account_login) do update set last_seen_at=now();
    raise exception 'old account upsert recreated removal';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_REMOVED' then raise; end if; end;
  begin
    insert into public.trades (user_id,broker_account_id,broker_trade_id,source,symbol,direction,entry_price)
      values (u,a,'old-removed','ea','XAUUSD','long',2600);
    raise exception 'old trade insert bypassed removal';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_REMOVED' then raise; end if; end;
  select id into trade_id from public.trades where user_id=u and broker_account_id=a;
  begin
    update public.trades set notes='old write' where id=trade_id;
    raise exception 'old trade update bypassed removal';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_REMOVED' then raise; end if; end;
  perform public.write_journal_trade(u,'update',trade_id,'{"notes":"Retained history edit"}');
  assert (select notes='Retained history edit' from public.trades where id=trade_id), 'retained history not editable';
  perform pg_temp.manage(u, a, 'reconnect');
  perform public.ingest_managed_journal(u, identity, rows);
  assert (select count(*) = 1 from public.trades where user_id = u), 'reconnect duplicates history';
  begin
    perform pg_temp.manage(u, a, 'remove', p_delete_trades => true, p_confirmation => 'wrong');
    raise exception 'purged without confirmation';
  exception when raise_exception then if sqlerrm <> 'CONFIRMATION_REQUIRED' then raise; end if; end;
  insert into public.trades (user_id, symbol, direction, entry_price) values (u, 'XAUUSD', 'long', 2600);
  select management_version into version from public.broker_accounts where id=a;
  result := public.manage_broker_account_v2(u,a,'remove',version,operation,p_delete_trades=>true,p_confirmation=>'555001');
  assert (result->>'deletedTrades')::int = 1, 'wrong purge count';
  assert (select count(*) = 1 from public.trades where user_id = u and broker_account_id is null), 'manual trade removed';


  receipt := public.manage_broker_account_v2(u,a,'remove',version,operation,p_delete_trades=>true,p_confirmation=>'555001');
  assert receipt = result, 'same-request retry changed receipt';
  begin
    perform public.manage_broker_account_v2(u,a,'remove',version,operation,p_delete_trades=>false);
    raise exception 'reused operation accepted changed payload';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_OPERATION_CONFLICT' then raise; end if; end;
  perform pg_temp.manage(u,a,'reconnect');
  perform public.ingest_managed_journal(u,identity,rows);
  begin
    perform public.manage_broker_account_v2(u,a,'remove',version,operation,p_delete_trades=>true,p_confirmation=>'555001');
    raise exception 'stale purge accepted after reconnect';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_STATE_CHANGED' then raise; end if; end;
  assert (select count(*)=1 from public.trades where user_id=u and broker_account_id=a), 'replayed purge erased new history';
  begin
    perform public.manage_broker_account(u,a,'remove');
    raise exception 'old management client accepted';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_CLIENT_OUTDATED' then raise; end if; end;
  perform public.save_journal_profile(u,'{"display_name":"First","reporting_timezone":"UTC"}');
  perform public.save_journal_profile(u,'{"display_name":"Second","reporting_timezone":"Asia/Manila"}');
  assert (select display_name='Second' and onboarding_completed_at=now() from public.profiles where id=u), 'profile update failed';
  perform public.manage_journal_api_key(other_user,'create',p_hash=>'key1',p_prefix=>'k1');
  perform public.manage_journal_api_key(other_user,'create',p_hash=>'key2',p_prefix=>'k2');
  perform public.manage_journal_api_key(other_user,'create',p_hash=>'key3',p_prefix=>'k3');
  begin
    perform public.manage_journal_api_key(other_user,'create',p_hash=>'key4',p_prefix=>'k4');
    raise exception 'key limit bypassed';
  exception when raise_exception then if sqlerrm <> 'API_KEY_LIMIT' then raise; end if; end;
  assert public.manage_journal_api_key(u,'revoke',p_key_id=>(select id from public.journal_api_keys where key_hash='key1')) is null, 'revoked other owner key';
  insert into public.subscribers (id,email,status,stripe_customer_id) values (u,'accounts-a@example.test','active','cus_local_test');
  begin
    perform public.prepare_journal_user_deletion(u);
    raise exception 'active billing bypassed';
  exception when raise_exception then if sqlerrm <> 'BILLING_REVIEW_REQUIRED' then raise; end if; end;
  assert (select deletion_requested_at is null from public.journal_access where user_id = u), 'billing conflict froze account';
  update public.subscribers set status = 'cancelled' where id = u;
  insert into public.journal_api_keys (user_id,key_hash,key_prefix) values (u,'account-test-hash','mf_test');
  insert into public.broker_connections (user_id,broker,api_key,api_secret_encrypted) values (u,'test','fake','fake');
  perform public.prepare_journal_user_deletion(u);
  perform public.prepare_journal_user_deletion(u);
  assert (select revoked_at is not null from public.journal_api_keys where user_id = u), 'key not revoked';
  begin
    insert into public.trades (user_id, symbol, direction, entry_price) values (u, 'XAUUSD', 'long', 2600);
    raise exception 'write after freeze allowed';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_DELETING' then raise; end if; end;
  begin
    update public.trades set notes='late' where user_id=u;
    raise exception 'update after freeze allowed';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_DELETING' then raise; end if; end;
  begin
    delete from public.trades where user_id=u;
    raise exception 'delete after freeze allowed';
  exception when raise_exception then if sqlerrm <> 'ACCOUNT_DELETING' then raise; end if; end;
  delete from auth.users where id = u;
  assert not exists (select 1 from public.trades where user_id = u), 'trades did not cascade';
  assert not exists (select 1 from public.broker_accounts where user_id = u), 'accounts did not cascade';
  assert not exists (select 1 from public.broker_connections where user_id = u), 'legacy connections did not cascade';
  assert not exists (select 1 from public.journal_api_keys where user_id = u), 'keys did not cascade';
  assert not exists (select 1 from public.profiles where id = u), 'profile did not cascade';
  assert not exists (select 1 from public.journal_access where user_id = u), 'access did not cascade';
  assert not exists (select 1 from public.subscribers where id = u), 'subscriber did not cascade';
  assert exists (select 1 from auth.users where id = other_user), 'other user removed';
  assert not has_function_privilege('authenticated','public.ingest_managed_journal(uuid,jsonb,jsonb)','EXECUTE'), 'browser can ingest with a forged owner';
  assert not has_function_privilege('anon','public.prepare_journal_user_deletion(uuid)','EXECUTE'), 'anonymous can freeze users';
  assert not has_function_privilege('authenticated','public.manage_broker_account_v2(uuid,bigint,text,integer,uuid,text,text,boolean,text)','EXECUTE'), 'browser can manage arbitrary owners';
  assert not has_function_privilege('anon','public.write_journal_trade(uuid,text,uuid,jsonb)','EXECUTE'), 'anonymous trade RPC';
  assert not has_function_privilege('authenticated','public.save_journal_profile(uuid,jsonb)','EXECUTE'), 'browser profile RPC';
  assert not has_function_privilege('authenticated','public.manage_journal_api_key(uuid,text,bigint,text,text)','EXECUTE'), 'browser key RPC';
end $$;
rollback;
