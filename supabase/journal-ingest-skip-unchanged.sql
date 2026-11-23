-- EA sync: leave unchanged trades alone.
-- The MT5 EA re-sends its recent closed trades every minute. Rewriting an
-- identical row bumped its revision and wrote an audit row on every sync,
-- growing journal_trade_revisions without bound and making notes/tag edits on
-- synced trades fail with "This trade changed" whenever a sync landed.
--
-- Redefines ingest_managed_journal from account-management.sql. Only the
-- ON CONFLICT clause (skip identical rows) and the counters (adds
-- "unchanged") differ. Rerunnable; apply after account-management-journal-compat.sql.
begin;
set local lock_timeout = '5s';

do $guard$
declare v_def text := pg_get_functiondef(to_regprocedure('public.ingest_managed_journal(uuid,jsonb,jsonb)'));
begin
  if v_def is null then
    raise exception 'Apply account-management.sql first.';
  end if;
  if position('v_unchanged' in v_def) = 0
    and position('stale_link = case when excluded.snapshot_id is null then public.trades.stale_link else excluded.stale_link end' in v_def) = 0 then
    raise exception 'ingest_managed_journal differs from the expected version; review it before migrating.';
  end if;
end
$guard$;

create or replace function public.ingest_managed_journal(
  p_user_id uuid, p_account jsonb, p_trades jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.broker_accounts; v_row jsonb; v_existing boolean;
  v_inserted integer := 0; v_updated integer := 0; v_unchanged integer := 0; v_linked integer := 0; v_stale integer := 0;
  v_snapshot_id bigint; v_snapshot_ts timestamptz; v_is_stale boolean; v_rows integer;
begin
  perform public.lock_journal_owner(p_user_id);
  if not exists (select 1 from public.journal_access where user_id = p_user_id and status = 'active') then
    raise exception 'JOURNAL_ACCESS_REVOKED';
  end if;
  select * into v_account from public.broker_accounts
    where user_id = p_user_id and server = p_account->>'server' and account_login = p_account->>'account_login' for update;
  if found and v_account.lifecycle <> 'active' then
    if v_account.lifecycle = 'removed' then raise exception 'ACCOUNT_REMOVED';
    else raise exception 'ACCOUNT_PAUSED'; end if;
  end if;
  insert into public.broker_accounts (user_id, account_login, server, currency, source, ea_version, last_seen_at)
    values (p_user_id, p_account->>'account_login', p_account->>'server', p_account->>'currency', 'ea', p_account->>'ea_version', now())
    on conflict (user_id, server, account_login) do update set currency = excluded.currency,
      ea_version = excluded.ea_version, last_seen_at = excluded.last_seen_at, updated_at = now()
    returning * into v_account;
  for v_row in select value from jsonb_array_elements(p_trades) loop
    select exists (select 1 from public.trades where user_id = p_user_id
      and broker_account_id = v_account.id and broker_trade_id = v_row->>'broker_trade_id') into v_existing;
    v_snapshot_id := null; v_snapshot_ts := null;
    select id, ts into v_snapshot_id, v_snapshot_ts from public.bias_snapshots
      where symbol = v_row->>'symbol' and ts <= (v_row->>'logged_at')::timestamptz order by ts desc limit 1;
    v_is_stale := coalesce((v_row->>'logged_at')::timestamptz - v_snapshot_ts > interval '30 minutes', false);
    insert into public.trades (user_id, broker_account_id, broker_trade_id, source, symbol, direction,
      entry_price, exit_price, result, pnl_amount, commission, swap, sl, tp, volume, risk_amount,
      r_multiple, logged_at, closed_at, snapshot_id, stale_link)
    values (p_user_id, v_account.id, v_row->>'broker_trade_id', 'ea', v_row->>'symbol', v_row->>'direction',
      (v_row->>'entry_price')::numeric, (v_row->>'exit_price')::numeric, v_row->>'result',
      (v_row->>'pnl_amount')::numeric, (v_row->>'commission')::numeric, (v_row->>'swap')::numeric,
      (v_row->>'sl')::numeric, (v_row->>'tp')::numeric, (v_row->>'volume')::numeric,
      (v_row->>'risk_amount')::numeric, (v_row->>'r_multiple')::numeric,
      (v_row->>'logged_at')::timestamptz, (v_row->>'closed_at')::timestamptz, v_snapshot_id, v_is_stale)
    on conflict (user_id, broker_account_id, broker_trade_id) do update set
      symbol = excluded.symbol, direction = excluded.direction, entry_price = excluded.entry_price,
      exit_price = excluded.exit_price, result = excluded.result, pnl_amount = excluded.pnl_amount,
      commission = excluded.commission, swap = excluded.swap, sl = excluded.sl, tp = excluded.tp,
      volume = excluded.volume, risk_amount = excluded.risk_amount, r_multiple = excluded.r_multiple,
      logged_at = excluded.logged_at, closed_at = excluded.closed_at,
      snapshot_id = coalesce(excluded.snapshot_id, public.trades.snapshot_id),
      stale_link = case when excluded.snapshot_id is null then public.trades.stale_link else excluded.stale_link end,
      updated_at = now()
    where (public.trades.symbol, public.trades.direction, public.trades.entry_price, public.trades.exit_price,
        public.trades.result, public.trades.pnl_amount, public.trades.commission, public.trades.swap,
        public.trades.sl, public.trades.tp, public.trades.volume, public.trades.risk_amount, public.trades.r_multiple,
        public.trades.logged_at, public.trades.closed_at, public.trades.snapshot_id, public.trades.stale_link)
      is distinct from (excluded.symbol, excluded.direction, excluded.entry_price, excluded.exit_price,
        excluded.result, excluded.pnl_amount, excluded.commission, excluded.swap,
        excluded.sl, excluded.tp, excluded.volume, excluded.risk_amount, excluded.r_multiple,
        excluded.logged_at, excluded.closed_at, coalesce(excluded.snapshot_id, public.trades.snapshot_id),
        case when excluded.snapshot_id is null then public.trades.stale_link else excluded.stale_link end);
    get diagnostics v_rows = row_count;
    if v_rows = 0 then v_unchanged := v_unchanged + 1;
    elsif v_existing then v_updated := v_updated + 1;
    else v_inserted := v_inserted + 1; end if;
    if v_snapshot_id is not null then
      v_linked := v_linked + 1;
      if v_is_stale then v_stale := v_stale + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged,
    'linked', v_linked, 'stale', v_stale);
end;
$$;

revoke all on function public.ingest_managed_journal(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_managed_journal(uuid,jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
