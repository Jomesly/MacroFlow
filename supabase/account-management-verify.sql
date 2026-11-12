-- READ ONLY. Run after base, hardening AND journal compatibility migrations,
-- before deploying the application.
-- Every returned row must be PASS. This verifies installation, not end-to-end behavior.
with required(signature) as (
  values
    ('public.list_managed_broker_accounts(uuid)'),
    ('public.ingest_managed_journal(uuid,jsonb,jsonb)'),
    ('public.prepare_journal_user_deletion(uuid)'),
    ('public.manage_broker_account_v2(uuid,bigint,text,integer,uuid,text,text,boolean,text)'),
    ('public.write_journal_trade(uuid,text,uuid,jsonb)'),
    ('public.save_journal_profile(uuid,jsonb)'),
    ('public.manage_journal_api_key(uuid,text,bigint,text,text)'),
    ('public.run_managed_journal_rpc(uuid,text,jsonb)')
), checks as (
  select signature as check_name,
    to_regprocedure(signature) is not null
      and has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE')
      and not has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE') as passed
  from required
  union all
  select 'broker_accounts.' || column_name,
    exists (select 1 from information_schema.columns c where c.table_schema = 'public'
      and c.table_name = 'broker_accounts' and c.column_name = required_columns.column_name)
  from (values ('lifecycle'), ('display_name'), ('notes'), ('removed_at'),
    ('management_version'), ('last_operation_id'), ('last_operation_request'),
    ('last_operation_result')) as required_columns(column_name)
  union all
  select 'journal_access.deletion_requested_at',
    exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'journal_access' and column_name = 'deletion_requested_at')
  union all
  select table_name || ' insert/update/delete guard',
    exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || table_name)
      and t.tgname = 'guard_account_deletion' and not t.tgisinternal
      and t.tgenabled = 'O' and t.tgtype = 31
      and t.tgfoid = to_regprocedure('public.guard_journal_write()'))
  from (values ('trades'), ('broker_accounts'), ('broker_connections'),
    ('journal_api_keys'), ('profiles')) as guarded(table_name)
  union all
  select table_name || ' insert/update/delete guard',
    exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || table_name)
      and t.tgname = 'guard_account_deletion' and not t.tgisinternal
      and t.tgenabled = 'O' and t.tgtype = 31
      and t.tgfoid = to_regprocedure('public.guard_extended_journal_write()'))
  from (values ('journal_accounts'), ('journal_trade_groups'), ('journal_account_funds'),
    ('journal_cash_entries'), ('journal_fund_revisions'), ('journal_fund_requests'),
    ('journal_trade_revisions'), ('journal_import_batches'), ('journal_import_rows'),
    ('journal_setup_tags')) as guarded(table_name)
  union all
  select table_name || ' Auth cascade',
    exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.' || table_name)
      and c.confrelid = to_regclass('auth.users') and c.contype = 'f' and c.confdeltype = 'c')
  from (values ('trades'), ('broker_accounts'), ('broker_connections'),
    ('journal_api_keys'), ('profiles'), ('journal_access'), ('subscribers'),
    ('journal_accounts'), ('journal_trade_groups'), ('journal_fund_requests'),
    ('journal_trade_revisions'), ('journal_import_batches'), ('journal_setup_tags')) as owned(table_name)
  union all
  select table_name || ' journal account cascade',
    exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.' || table_name)
      and c.confrelid = to_regclass('public.journal_accounts') and c.contype = 'f' and c.confdeltype = 'c')
  from (values ('journal_account_funds'), ('journal_cash_entries'), ('journal_fund_revisions')) as owned(table_name)
  union all
  select 'journal_import_rows batch cascade',
    exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.journal_import_rows')
      and c.confrelid = to_regclass('public.journal_import_batches') and c.contype = 'f' and c.confdeltype = 'c')
)
select check_name, case when passed then 'PASS' else 'FAIL - STOP' end as status
from checks order by check_name;
