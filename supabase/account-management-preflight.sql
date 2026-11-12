-- READ ONLY. Run in the intended hosted project's SQL Editor before migration.
-- Confirm the project and its backup separately before applying any changes.
with prerequisites(name) as (
  values ('auth.users'), ('public.trades'), ('public.broker_accounts'),
    ('public.broker_connections'), ('public.journal_api_keys'),
    ('public.profiles'), ('public.journal_access'), ('public.subscribers'),
    ('public.bias_snapshots'), ('public.journal_accounts'), ('public.journal_trade_groups'),
    ('public.journal_account_funds'), ('public.journal_cash_entries'), ('public.journal_fund_revisions'),
    ('public.journal_fund_requests'), ('public.journal_trade_revisions'),
    ('public.journal_import_batches'), ('public.journal_import_rows'), ('public.journal_setup_tags')
)
select name as prerequisite,
  case when to_regclass(name) is not null then 'PASS' else 'MISSING - STOP' end as status
from prerequisites order by name;

with state as (
  select
    exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'broker_accounts' and column_name = 'lifecycle') as base_present,
    exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'broker_accounts' and column_name = 'management_version') as hardening_present
)
select base_present, hardening_present,
  case
    when hardening_present and not base_present then 'STOP: inconsistent schema; inspect before migration'
    when base_present then 'Skip account-management.sql; apply account-management-hardening.sql, then account-management-journal-compat.sql'
    else 'Apply account-management.sql, then account-management-hardening.sql, then account-management-journal-compat.sql'
  end as migration_order
from state;
