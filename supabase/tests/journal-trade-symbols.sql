-- Disposable local database only. All fixtures roll back.
-- Every dashboard market can be logged by hand and imported from CSV;
-- instruments outside the journal are still rejected by the database.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid := gen_random_uuid(); a uuid; batch uuid; v_result jsonb; v_symbol text; v_row integer := 1;
  markets text[] := array['XAUUSD','GBPUSD','US100','DJ30','BTCUSD','US500','EURUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NZDUSD'];
  import_rows jsonb := '[]';
begin
  insert into auth.users(id, email) values (u, 'symbols-' || u || '@example.test');
  v_result := public.run_managed_journal_rpc(u, 'create_journal_account', '{"p_values":{"broker_name":"Test","account_number":"symbols","currency":"USD","nickname":"Manual"}}');
  a := (v_result->>'id')::uuid;

  foreach v_symbol in array markets loop
    v_result := public.run_managed_journal_rpc(u, 'create_journal_trade_batch', jsonb_build_object('p_request', gen_random_uuid(), 'p_payload', jsonb_build_object(
      'symbol', v_symbol, 'direction', 'short', 'entryPrice', 1.2, 'openedAt', now() - interval '2 days', 'setupTags', '[]'::jsonb,
      'accounts', jsonb_build_array(jsonb_build_object('accountId', a)))));
    assert (select symbol = v_symbol from public.trades where trade_group_id = (v_result->>'groupId')::uuid), v_symbol || ' manual trade not saved';
    v_row := v_row + 1;
    import_rows := import_rows || jsonb_build_array(jsonb_build_object('row', v_row, 'status', 'ready', 'cells', '[]'::jsonb, 'errors', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'trade', jsonb_build_object('symbol', v_symbol, 'direction', 'long', 'entryPrice', 1.2, 'timestamp', now() - interval '1 day', 'setupTags', '[]'::jsonb, 'notes', 'import')));
  end loop;

  batch := gen_random_uuid();
  perform public.run_managed_journal_rpc(u, 'stage_journal_import', jsonb_build_object('p_id', batch, 'p_payload', jsonb_build_object(
    'accountId', a, 'filename', 'symbols.csv', 'fileHash', 'symbols', 'options', '{}'::jsonb, 'openingVersion', 0, 'rows', import_rows)));
  v_result := public.run_managed_journal_rpc(u, 'commit_journal_import', jsonb_build_object('p_batch', batch,
    'p_rows', (select jsonb_agg(value->'row') from jsonb_array_elements(import_rows)), 'p_keep', '[]'::jsonb));
  assert (v_result->>'count')::int = 12, 'CSV import rejected a dashboard market';
  assert (select count(distinct symbol) = 12 from public.trades where import_batch_id = batch), 'imported symbols changed';

  begin
    perform public.run_managed_journal_rpc(u, 'create_journal_trade_batch', jsonb_build_object('p_request', gen_random_uuid(), 'p_payload', jsonb_build_object(
      'symbol', 'EURGBP', 'direction', 'long', 'entryPrice', 0.85, 'openedAt', now() - interval '2 days', 'setupTags', '[]'::jsonb,
      'accounts', jsonb_build_array(jsonb_build_object('accountId', a)))));
    raise exception 'unsupported manual symbol accepted';
  exception when invalid_parameter_value then null; end;

  batch := gen_random_uuid();
  perform public.run_managed_journal_rpc(u, 'stage_journal_import', jsonb_build_object('p_id', batch, 'p_payload', jsonb_build_object(
    'accountId', a, 'filename', 'other.csv', 'fileHash', 'other', 'options', '{}'::jsonb, 'openingVersion', 0,
    'rows', jsonb_build_array(jsonb_build_object('row', 2, 'status', 'ready', 'cells', '[]'::jsonb, 'errors', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'trade', jsonb_build_object('symbol', 'EURGBP', 'direction', 'long', 'entryPrice', 0.85, 'timestamp', now() - interval '1 day', 'setupTags', '[]'::jsonb, 'notes', 'import'))))));
  begin
    perform public.run_managed_journal_rpc(u, 'commit_journal_import', jsonb_build_object('p_batch', batch, 'p_rows', '[2]'::jsonb, 'p_keep', '[]'::jsonb));
    raise exception 'unsupported imported symbol accepted';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
