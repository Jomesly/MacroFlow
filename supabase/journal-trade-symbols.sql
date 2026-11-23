-- Journal symbols: every dashboard market can be logged by hand and imported
-- from CSV. EA sync needs no database change; it relies on src/lib/types.ts.
--
-- Apply after journal-account-funds.sql and journal-imports.sql. Rerunnable.
-- Only the supported-symbol list inside the two installed functions changes;
-- the rest of each deployed function body is kept exactly as installed. If a
-- body does not contain the expected list, nothing is changed.
begin;
set local lock_timeout = '5s';

do $migration$
declare
  v_new constant text := $$('XAUUSD','GBPUSD','US100','DJ30','BTCUSD','US500','EURUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD')$$;
  v_old constant text[] := array[
    $$('XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD')$$,
    $$('XAUUSD','GBPUSD','US100','DJ30','BTCUSD')$$];
  v_fn regprocedure;
  v_def text;
  v_list text;
begin
  foreach v_fn in array array[
    to_regprocedure('public.create_journal_trade_batch(uuid,uuid,jsonb)'),
    to_regprocedure('public.commit_journal_import(uuid,uuid,integer[],integer[])')] loop
    if v_fn is null then
      raise exception 'Apply journal-account-funds.sql and journal-imports.sql first.';
    end if;
    v_def := pg_get_functiondef(v_fn);
    continue when position(v_new in v_def) > 0; -- already migrated
    foreach v_list in array v_old loop
      v_def := replace(v_def, v_list, v_new);
    end loop;
    if position(v_new in v_def) = 0 then
      raise exception 'Supported-symbol list not found in %; review the installed function first.', v_fn;
    end if;
    execute v_def;
  end loop;
end
$migration$;

notify pgrst, 'reload schema';
commit;
