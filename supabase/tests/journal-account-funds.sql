-- Disposable local database only; this suite rolls back all fixtures.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000091', 'funds-a@example.test'),
 ('00000000-0000-4000-8000-000000000092', 'funds-b@example.test');

do $$
<<journal_account_funds_test>>
declare
  owner_id uuid := '00000000-0000-4000-8000-000000000091';
  stranger uuid := '00000000-0000-4000-8000-000000000092';
  a uuid; b uuid; crypto_account uuid; synced uuid; broker_id bigint;
  request uuid; trade_id uuid; deposit_id uuid; withdrawal_id uuid;
  payload jsonb; output jsonb; retry jsonb; summary jsonb; count_before integer;
begin
  insert into public.journal_accounts(user_id, broker_name, account_number, nickname, currency) values(owner_id, 'Test', '00001', 'Personal', 'USD') returning id into a;
  insert into public.journal_accounts(user_id, broker_name, account_number, nickname, currency) values(owner_id, 'Test', '00002', 'Funded', 'USD') returning id into b;
  insert into public.journal_accounts(user_id, broker_name, account_number, currency) values(owner_id, 'Crypto', 'btc', 'BTC') returning id into crypto_account;
  insert into public.broker_accounts(user_id, account_login, server, currency) values(owner_id, 'funds-sync', 'Test-Live', 'USD') returning id into broker_id;
  select id into synced from public.journal_accounts where broker_account_id = broker_id;
  payload := jsonb_build_object('symbol','XAUUSD','direction','long','entryPrice',2000,'openedAt',now() - interval '2 days','setupTags',jsonb_build_array('Sweep'),'notes','same decision',
    'accounts',jsonb_build_array(jsonb_build_object('accountId', a), jsonb_build_object('accountId', b)));
  request := gen_random_uuid();
  output := public.create_journal_trade_batch(owner_id, request, payload);
  retry := public.create_journal_trade_batch(owner_id, request, payload);
  assert output = retry, 'retry must return original result';
  assert (select count(*) = 2 from public.trades where trade_group_id = (output->>'groupId')::uuid), 'batch must create two copies';
  begin
    perform public.create_journal_trade_batch(owner_id, request, payload || '{"notes":"different"}');
    raise exception 'idempotency content conflict accepted';
  exception when serialization_failure then null; end;
  select count(*) into count_before from public.trades where user_id = owner_id;
  begin
    perform public.create_journal_trade_batch(owner_id, gen_random_uuid(), payload || jsonb_build_object('accounts', jsonb_build_array(jsonb_build_object('accountId', a), jsonb_build_object('accountId','ffffffff-ffff-4fff-8fff-ffffffffffff'))));
    raise exception 'nonexistent destination accepted';
  exception when insufficient_privilege then null; end;
  assert (select count(*) = count_before from public.trades where user_id = owner_id), 'partial batch survived';
  begin
    perform public.create_journal_trade_batch(stranger, gen_random_uuid(), payload);
    raise exception 'cross-owner batch accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_journal_trade_batch(owner_id, gen_random_uuid(), payload || jsonb_build_object('accounts', jsonb_build_array(jsonb_build_object('accountId', a), jsonb_build_object('accountId', a))));
    raise exception 'duplicate destination accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_journal_trade_batch(owner_id, gen_random_uuid(), payload || jsonb_build_object('accounts', jsonb_build_array(jsonb_build_object('accountId', synced))));
    raise exception 'manual copy into synced account accepted';
  exception when invalid_parameter_value then null; end;

  perform public.mutate_journal_funds(owner_id, a, gen_random_uuid(), jsonb_build_object('action','set-opening','amount','1000','effectiveAt',now()-interval '10 days','expectedVersion',0));
  request := gen_random_uuid();
  payload := jsonb_build_object('action','add','kind','deposit','amount','500','effectiveAt',now()-interval '9 days','note','initial deposit');
  output := public.mutate_journal_funds(owner_id, a, request, payload);
  deposit_id := (output->>'entryId')::uuid;
  assert output = public.mutate_journal_funds(owner_id, a, request, payload), 'funds retry duplicated';
  output := public.mutate_journal_funds(owner_id, a, gen_random_uuid(), jsonb_build_object('action','add','kind','withdrawal','amount','100','effectiveAt',now()-interval '8 days'));
  withdrawal_id := (output->>'entryId')::uuid;
  perform public.mutate_journal_funds(owner_id, a, gen_random_uuid(), jsonb_build_object('action','add','kind','adjustment-increase','amount','25','effectiveAt',now()-interval '7 days','note','statement correction'));
  perform public.mutate_journal_funds(owner_id, a, gen_random_uuid(), jsonb_build_object('action','add','kind','fee','amount','5','effectiveAt',now()-interval '6 days'));

  payload := jsonb_build_object('symbol','XAUUSD','direction','long','entryPrice',2000,'openedAt',now()-interval '2 days','setupTags','[]'::jsonb,'notes','different money per account',
    'accounts',jsonb_build_array(jsonb_build_object('accountId',a,'netPnl','80','exitPrice',2010,'closedAt',now()-interval '1 day'),jsonb_build_object('accountId',b,'netPnl','250','exitPrice',2011,'closedAt',now()-interval '1 day')));
  output := public.create_journal_trade_batch(owner_id, gen_random_uuid(), payload);
  select id into trade_id from public.trades where trade_group_id = (output->>'groupId')::uuid and journal_account_id = a;
  assert (select pnl_amount = 250 from public.trades where trade_group_id = (output->>'groupId')::uuid and journal_account_id = b), 'per-account result lost';
  insert into public.trades(user_id,journal_account_id,symbol,direction,entry_price,result,pnl_amount,logged_at,closed_at)
    values(owner_id,a,'XAUUSD','long',100,'win',9000,now()-interval '20 days',now()-interval '15 days');
  summary := public.read_journal_funds(owner_id,a);
  assert (summary#>>'{summary,balance}')::numeric = 1500, 'balance equation or opening cutoff incorrect';
  assert (summary#>>'{summary,netPnl}')::numeric = 80, 'deposits counted as trading profit';
  assert (summary#>>'{summary,complete}')::boolean, 'complete coverage unexpectedly false';
  perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','edit','entryId',deposit_id,'expectedVersion',1,'kind','deposit','amount','600','effectiveAt',now()-interval '9 days','reason','correct amount'));
  perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','void','entryId',withdrawal_id,'expectedVersion',1,'reason','duplicate statement line'));
  summary := public.read_journal_funds(owner_id,a);
  assert (summary#>>'{summary,balance}')::numeric = 1700, 'edit or void double-counted';
  assert (select count(*) = 2 from public.journal_fund_revisions where entry_id = deposit_id), 'deposit revision history missing';
  begin
    perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','edit','entryId',deposit_id,'expectedVersion',1,'kind','deposit','amount','700','effectiveAt',now()-interval '9 days','reason','stale edit'));
    raise exception 'stale correction accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','void','entryId',withdrawal_id,'expectedVersion',2,'reason','void again'));
    raise exception 'double void accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.mutate_journal_funds(stranger,a,gen_random_uuid(),jsonb_build_object('action','set-opening','amount','0','effectiveAt',now(),'expectedVersion',0));
    raise exception 'cross-owner funds accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','add','kind','deposit','amount','1','effectiveAt',now()-interval '11 days'));
    raise exception 'pre-snapshot cash accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','set-opening','amount','10','effectiveAt',now()-interval '5 days','expectedVersion',1,'note','new cutoff'));
    raise exception 'opening moved past existing funds';
  exception when invalid_parameter_value then null; end;
  perform public.mutate_journal_funds(owner_id,a,gen_random_uuid(),jsonb_build_object('action','set-opening','amount','1100','effectiveAt',now()-interval '10 days','expectedVersion',1,'note','correct starting amount'));
  assert (public.read_journal_funds(owner_id,a)#>>'{summary,balance}')::numeric = 1800, 'opening correction not reflected';

  perform public.update_journal_trade(owner_id,trade_id,1,jsonb_build_object('entryPrice',2000,'exitPrice',null,'closedAt',null,'netPnl',null,'result',null,'setupTags','[]'::jsonb,'notes','reopened'));
  assert (public.read_journal_funds(owner_id,a)#>>'{summary,balance}')::numeric = 1720, 'reopening failed to remove realized P&L';
  assert (select count(*) = 1 from public.journal_trade_revisions r where r.trade_id = journal_account_funds_test.trade_id), 'trade change not audited';
  assert (select pnl_amount = 250 from public.trades where trade_group_id = (output->>'groupId')::uuid and journal_account_id = b), 'editing one copy changed its sibling';
  begin
    perform public.update_journal_trade(owner_id,trade_id,1,jsonb_build_object('entryPrice',2000,'setupTags','[]'::jsonb));
    raise exception 'stale trade edit accepted';
  exception when serialization_failure then null; end;
  update public.trades set result='win' where id=trade_id;
  assert (public.read_journal_funds(owner_id,a)#>>'{summary,missingDates}')::integer = 1, 'unknown closing date hidden';
  update public.trades set closed_at=now()-interval '1 day' where id=trade_id;
  assert (public.read_journal_funds(owner_id,a)#>>'{summary,missingPnl}')::integer = 1, 'unknown cash result treated as zero';
  delete from public.trades where id=trade_id;
  assert (public.read_journal_funds(owner_id,a)#>>'{summary,complete}')::boolean, 'deletion did not recalculate coverage';

  perform public.mutate_journal_funds(owner_id,crypto_account,gen_random_uuid(),jsonb_build_object('action','set-opening','amount','0.10000001','effectiveAt',now()-interval '2 days','expectedVersion',0));
  perform public.mutate_journal_funds(owner_id,crypto_account,gen_random_uuid(),jsonb_build_object('action','add','kind','deposit','amount','0.00000002','effectiveAt',now()-interval '1 day'));
  assert (public.read_journal_funds(owner_id,crypto_account)#>>'{summary,balance}')::numeric = 0.10000003, 'crypto precision lost';
  begin
    perform public.journal_money('1.001','USD'); raise exception 'unsupported currency precision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.journal_accounts set currency='EUR' where id=a; raise exception 'funded account currency changed';
  exception when invalid_parameter_value then null; end;
  assert not has_table_privilege('authenticated','public.journal_cash_entries','SELECT'), 'browser ledger access';
  assert not has_function_privilege('anon','public.mutate_journal_funds(uuid,uuid,uuid,jsonb)','EXECUTE'), 'anonymous ledger RPC';
  assert not has_function_privilege('authenticated','public.create_journal_trade_batch(uuid,uuid,jsonb)','EXECUTE'), 'browser batch RPC';
end $$;
rollback;
select 'journal funds and multi-account assertions passed' as result;
