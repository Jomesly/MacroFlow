-- Disposable database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid; t uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid();
  v_result jsonb; trade_payload jsonb; imported uuid; broker bigint; import_payload jsonb;
begin
  insert into auth.users(id,email) values(u,'compat-'||u||'@example.test');
  v_result:=public.run_managed_journal_rpc(u,'create_journal_account','{"p_values":{"broker_name":"Test","account_number":"compat","currency":"USD","nickname":"Manual"}}');
  a:=(v_result->>'id')::uuid;
  perform public.run_managed_journal_rpc(u,'rename_journal_account',jsonb_build_object('p_account_id',a,'p_values','{"nickname":"Renamed"}'::jsonb));
  assert (select nickname='Renamed' from public.journal_accounts where id=a),'rename failed';
  perform public.run_managed_journal_rpc(u,'create_journal_trade',jsonb_build_object('p_trade_id',t,'p_values',jsonb_build_object('journal_account_id',a,'symbol','XAUUSD','direction','long','entry_price',2000,'setup_tags','[]'::jsonb)));
  assert (select journal_account_id=a from public.trades where id=t),'manual destination lost';
  trade_payload:=jsonb_build_object('entryPrice',2000,'exitPrice',2010,'closedAt',now(),'netPnl','25.50','result','win','notes','reviewed','setupTags','["Test"]'::jsonb);
  v_result:=public.run_managed_journal_rpc(u,'update_journal_trade',jsonb_build_object('p_trade',t,'p_version',1,'p_payload',trade_payload));
  assert (v_result->>'revision')::int=2 and (v_result->>'pnl_amount_exact')::numeric=25.50,'revision/money lost';
  begin
    perform public.run_managed_journal_rpc(u,'update_journal_trade',jsonb_build_object('p_trade',t,'p_version',1,'p_payload',trade_payload));
    raise exception 'stale revision accepted';
  exception when serialization_failure then null; end;
  perform public.run_managed_journal_rpc(u,'mutate_journal_funds',jsonb_build_object('p_account',a,'p_request',gen_random_uuid(),'p_payload',jsonb_build_object('action','set-opening','amount','1000','effectiveAt',now()-interval '10 days','expectedVersion',0)));
  perform public.run_managed_journal_rpc(u,'mutate_journal_funds',jsonb_build_object('p_account',a,'p_request',gen_random_uuid(),'p_payload',jsonb_build_object('action','add','kind','deposit','amount','50','effectiveAt',now()-interval '9 days')));
  v_result:=public.run_managed_journal_rpc(u,'create_journal_trade_batch',jsonb_build_object('p_request',gen_random_uuid(),'p_payload',jsonb_build_object('symbol','XAUUSD','direction','long','entryPrice',2000,'openedAt',now()-interval '2 days','setupTags','[]'::jsonb,'accounts',jsonb_build_array(jsonb_build_object('accountId',a)))));
  assert (select count(*)=1 from public.trades where trade_group_id=(v_result->>'groupId')::uuid),'batch wrapper failed';
  import_payload:=jsonb_build_object('accountId',a,'filename','test.csv','fileHash','compat','options','{}'::jsonb,'openingVersion',1,
    'rows',jsonb_build_array(jsonb_build_object('row',2,'status','ready','cells','[]'::jsonb,'errors','[]'::jsonb,'warnings','[]'::jsonb,'trade',jsonb_build_object('symbol','GBPUSD','direction','long','entryPrice',1.2,'timestamp',now()-interval '1 day','setupTags','["Imported"]'::jsonb,'notes','import'))));
  perform public.run_managed_journal_rpc(u,'stage_journal_import',jsonb_build_object('p_id',batch,'p_payload',import_payload));
  v_result:=public.run_managed_journal_rpc(u,'commit_journal_import',jsonb_build_object('p_batch',batch,'p_rows','[2]'::jsonb,'p_keep','[]'::jsonb));
  assert (v_result->>'count')::int=1,'CSV commit failed';
  v_result:=public.run_managed_journal_rpc(u,'undo_journal_import',jsonb_build_object('p_batch',batch,'p_expected',1));
  assert (v_result->>'removed')::int=1,'CSV undo failed';
  -- Keep a committed import through Auth deletion to exercise SET NULL cascades.
  batch:=gen_random_uuid();
  perform public.run_managed_journal_rpc(u,'stage_journal_import',jsonb_build_object('p_id',batch,'p_payload',import_payload));
  perform public.run_managed_journal_rpc(u,'commit_journal_import',jsonb_build_object('p_batch',batch,'p_rows','[2]'::jsonb,'p_keep','[]'::jsonb));
  assert exists(select 1 from public.journal_import_rows where batch_id=batch and trade_id is not null),'committed import fixture missing';
  perform public.ingest_managed_journal(u,'{"account_login":"compat","server":"Broker","currency":"USD"}',
    '[{"broker_trade_id":"ticket","symbol":"XAUUSD","direction":"long","entry_price":2000,"exit_price":2010,"pnl_amount":10,"result":"win","logged_at":"2026-11-01T00:00:00Z","closed_at":"2026-11-01T01:00:00Z"}]');
  select id into broker from public.broker_accounts where user_id=u;
  perform public.manage_broker_account_v2(u,broker,'remove',1,gen_random_uuid());
  select id into imported from public.trades where broker_account_id=broker;
  select jsonb_build_object('entryPrice',entry_price,'exitPrice',exit_price,'closedAt',closed_at,'netPnl',pnl_amount,'result',result,'notes','retained','setupTags','[]'::jsonb) into trade_payload from public.trades where id=imported;
  v_result:=public.run_managed_journal_rpc(u,'update_journal_trade',jsonb_build_object('p_trade',imported,'p_version',1,'p_payload',trade_payload));
  assert v_result->>'notes'='retained','retained revision edit failed';
  assert coalesce(current_setting('macroflow.trade_edit',true),'')<>'1','edit marker leaked';
  perform public.prepare_journal_user_deletion(u);
  begin
    perform public.run_managed_journal_rpc(u,'create_journal_account','{"p_values":{"broker_name":"Late","account_number":"late"}}');
    raise exception 'wrapper ignored freeze';
  exception when raise_exception then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  begin
    insert into public.journal_setup_tags(user_id,name) values(u,'late');
    raise exception 'tag ignored freeze';
  exception when raise_exception then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  begin
    update public.journal_accounts set nickname='late' where id=a;
    raise exception 'account ignored freeze';
  exception when raise_exception then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  delete from auth.users where id=u;
  assert not exists(select 1 from public.journal_accounts where user_id=u),'account cascade failed';
  assert not exists(select 1 from public.journal_cash_entries where user_id=u),'funds cascade failed';
  assert not exists(select 1 from public.journal_trade_revisions where user_id=u),'audit cascade failed';
  assert not exists(select 1 from public.journal_import_batches where user_id=u),'import cascade failed';
  assert not exists(select 1 from public.journal_trade_groups where user_id=u),'groups cascade failed';
  assert not has_function_privilege('authenticated','public.run_managed_journal_rpc(uuid,text,jsonb)','EXECUTE'),'browser RPC access';
  assert not has_function_privilege('anon','public.run_managed_journal_rpc(uuid,text,jsonb)','EXECUTE'),'anonymous RPC access';
end $$;
rollback;
