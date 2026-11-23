-- Disposable database only. All fixtures roll back.
-- The EA re-sends recent trades every minute. An unchanged trade must not be
-- rewritten: no revision bump, no audit row, and notes edits made against the
-- current revision keep working. Real broker changes still update the trade.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid := gen_random_uuid(); v_result jsonb; t uuid; rev integer; payload jsonb;
  identity jsonb := '{"account_login":"sync-test","server":"Broker-Live","currency":"USD","ea_version":"1.3"}';
  rows jsonb := '[{"broker_trade_id":"9001","symbol":"USDCAD","direction":"short","entry_price":1.43375,"exit_price":1.4339,"result":"loss","pnl_amount":-2.09,"commission":0,"swap":0,"volume":0.2,"logged_at":"2026-11-23T00:17:10Z","closed_at":"2026-11-23T00:20:24Z"}]';
  corrected jsonb := '[{"broker_trade_id":"9001","symbol":"USDCAD","direction":"short","entry_price":1.43375,"exit_price":1.4339,"result":"loss","pnl_amount":-3.29,"commission":-1.2,"swap":0,"volume":0.2,"logged_at":"2026-11-23T00:17:10Z","closed_at":"2026-11-23T00:20:24Z"}]';
begin
  insert into auth.users(id, email) values (u, 'sync-' || u || '@example.test');
  v_result := public.ingest_managed_journal(u, identity, rows);
  assert (v_result->>'inserted')::int = 1, 'first sync must insert';
  select id, revision into t, rev from public.trades where user_id = u and broker_trade_id = '9001';

  v_result := public.ingest_managed_journal(u, identity, rows);
  assert (v_result->>'inserted')::int = 0 and (v_result->>'updated')::int = 0 and (v_result->>'unchanged')::int = 1,
    'identical re-sync must report unchanged, got ' || v_result::text;
  assert (select revision from public.trades where id = t) = rev, 'identical re-sync bumped the revision';
  assert not exists (select 1 from public.journal_trade_revisions where trade_id = t), 'identical re-sync wrote audit history';

  select jsonb_build_object('entryPrice', entry_price, 'exitPrice', exit_price, 'closedAt', closed_at, 'netPnl', pnl_amount,
    'result', result, 'notes', 'reviewed', 'setupTags', '[]'::jsonb) into payload from public.trades where id = t;
  perform public.run_managed_journal_rpc(u, 'update_journal_trade', jsonb_build_object('p_trade', t, 'p_version', rev, 'p_payload', payload));
  assert (select revision from public.trades where id = t) = rev + 1, 'notes edit must bump the revision once';

  v_result := public.ingest_managed_journal(u, identity, rows);
  assert (v_result->>'unchanged')::int = 1, 'sync after a notes edit must leave the trade unchanged';
  assert (select revision = rev + 1 and notes = 'reviewed' from public.trades where id = t), 'sync changed the revision or the notes';
  -- Before the fix this raised "This trade changed" because every sync bumped the revision.
  perform public.run_managed_journal_rpc(u, 'update_journal_trade', jsonb_build_object('p_trade', t, 'p_version', rev + 1,
    'p_payload', payload || '{"notes":"reviewed twice"}'));

  v_result := public.ingest_managed_journal(u, identity, corrected);
  assert (v_result->>'updated')::int = 1 and (v_result->>'unchanged')::int = 0, 'a corrected commission must update, got ' || v_result::text;
  assert (select pnl_amount = -3.29 and commission = -1.2 and revision = rev + 3 and notes = 'reviewed twice' from public.trades where id = t),
    'corrected sync must update money once and keep notes';
  assert (select count(*) = 3 from public.journal_trade_revisions where trade_id = t), 'only real changes are audited';
end $$;
rollback;
