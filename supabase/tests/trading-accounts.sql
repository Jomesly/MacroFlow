-- Disposable local database only. Seed old-format records before migrating.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000011','accounts-a@example.test'),
 ('00000000-0000-0000-0000-000000000012','accounts-b@example.test');
insert into public.trades(user_id,symbol,direction,entry_price,notes)
 values('00000000-0000-0000-0000-000000000011','XAUUSD','long',2000,'legacy manual');
insert into public.broker_accounts(user_id,account_login,server,currency)
 values('00000000-0000-0000-0000-000000000011','00123456','Test-Live','USD');
insert into public.trades(user_id,symbol,direction,entry_price,broker_account_id,broker_trade_id,source)
 select user_id,'GBPUSD','short',1.3,id,'ticket-1','ea' from public.broker_accounts where account_login='00123456';

\ir ../trading-accounts.sql
do $$ declare account_id uuid; begin
  assert (select count(*) = 2 from public.trades where user_id='00000000-0000-0000-0000-000000000011'), 'migration changed trade count';
  assert (select count(*) = 2 from public.journal_accounts where user_id='00000000-0000-0000-0000-000000000011'), 'manual and broker backfill';
  assert not exists(select 1 from public.trades where journal_account_id is null), 'unassigned migrated trade';
  assert (select account_number='00123456' from public.journal_accounts where broker_account_id is not null), 'leading zeros lost';
  select id into account_id from public.journal_accounts where is_default and user_id='00000000-0000-0000-0000-000000000011';
  begin
    insert into public.trades(user_id,symbol,direction,entry_price,journal_account_id)
      values('00000000-0000-0000-0000-000000000012','XAUUSD','long',2000,account_id);
    raise exception 'cross-owner account accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.journal_accounts(user_id,broker_name,account_number,server,currency)
      values('00000000-0000-0000-0000-000000000011','test-live','00123456','test-live','USD');
    raise exception 'duplicate identity accepted';
  exception when unique_violation then null;
  end;
  assert not has_table_privilege('anon','public.journal_accounts','SELECT'), 'anonymous access';
  assert not has_table_privilege('authenticated','public.journal_accounts','INSERT'), 'browser write access';
  assert not has_function_privilege('authenticated','public.ensure_broker_journal_account(uuid,bigint)','EXECUTE'), 'browser provisioner access';
end $$;
update public.journal_accounts set nickname='Keep this nickname' where broker_account_id is not null;
\ir ../trading-accounts.sql
do $$ begin
  assert (select count(*)=2 from public.journal_accounts where user_id='00000000-0000-0000-0000-000000000011'), 'rerun duplicated accounts';
  assert (select nickname='Keep this nickname' from public.journal_accounts where broker_account_id is not null), 'rerun overwrote nickname';
end $$;

-- New clients and old clients remain compatible after the migration.
insert into public.broker_accounts(user_id,account_login,server,currency)
 values('00000000-0000-0000-0000-000000000012','abc-002','Another-Live','EUR');
insert into public.trades(user_id,symbol,direction,entry_price)
 values('00000000-0000-0000-0000-000000000012','US100','long',100);
do $$ begin
  assert exists(select 1 from public.journal_accounts where account_number='abc-002'), 'new empty broker account missing';
  assert exists(select 1 from public.journal_accounts where is_default and user_id='00000000-0000-0000-0000-000000000012'), 'old manual client failed';
end $$;
select 'trading account migration assertions passed' as result;
