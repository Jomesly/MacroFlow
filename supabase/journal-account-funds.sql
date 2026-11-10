-- Apply after trading-accounts.sql. Additive, transactional and rerunnable.
-- All access is through owner-checked server routes and service-role RPCs.
begin;

create table if not exists public.journal_trade_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, id), unique(user_id, request_id)
);
alter table public.trades add column if not exists trade_group_id uuid;
alter table public.trades add column if not exists revision integer not null default 1;
alter table public.trades add column if not exists pnl_amount_exact text generated always as (pnl_amount::text) stored;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trades_group_owner_fk' and conrelid = 'public.trades'::regclass) then
    alter table public.trades add constraint trades_group_owner_fk foreign key(user_id, trade_group_id)
      references public.journal_trade_groups(user_id, id);
  end if;
end $$;
create unique index if not exists trades_group_account_idx on public.trades(trade_group_id, journal_account_id) where trade_group_id is not null;

create table if not exists public.journal_account_funds (
  account_id uuid primary key,
  user_id uuid not null,
  amount numeric not null,
  effective_at timestamptz not null,
  note text not null default '',
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  foreign key(user_id, account_id) references public.journal_accounts(user_id, id) on delete cascade
);
create table if not exists public.journal_cash_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  kind text not null check (kind in ('deposit', 'withdrawal', 'adjustment-increase', 'adjustment-decrease', 'fee')),
  amount numeric not null check (amount <> 0),
  effective_at timestamptz not null,
  note text not null default '' check (length(note) <= 1000),
  version integer not null default 1 check (version > 0),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(user_id, account_id) references public.journal_accounts(user_id, id) on delete cascade,
  check ((kind in ('deposit', 'adjustment-increase') and amount > 0) or (kind in ('withdrawal', 'adjustment-decrease', 'fee') and amount < 0))
);
create index if not exists journal_cash_account_date_idx on public.journal_cash_entries(user_id, account_id, effective_at desc, id);
create table if not exists public.journal_fund_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  entry_id uuid,
  operation text not null,
  reason text not null default '',
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(user_id, account_id) references public.journal_accounts(user_id, id) on delete cascade
);
create index if not exists journal_fund_revision_idx on public.journal_fund_revisions(user_id, account_id, entry_id, created_at);
create table if not exists public.journal_fund_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  account_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(user_id, request_id),
  foreign key(user_id, account_id) references public.journal_accounts(user_id, id) on delete cascade
);
create table if not exists public.journal_trade_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  trade_id uuid not null,
  operation text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  foreign key(user_id, account_id) references public.journal_accounts(user_id, id) on delete cascade
);

-- Exact money validation is repeated in the transaction, not just the form.
create or replace function public.journal_money(p_value text, p_currency text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare precision_digits integer; value numeric;
begin
  if p_value is null or p_value !~ '^-?[0-9]{1,15}(\.[0-9]{1,8})?$' then
    raise exception using errcode = '22023', message = 'Enter a decimal amount with up to 15 whole digits and 8 decimal places.';
  end if;
  if p_currency is null then raise exception using errcode = '22023', message = 'Set the account currency before recording money.'; end if;
  precision_digits := case
    when p_currency in ('BTC', 'ETH', 'USDT', 'USDC') then 8
    when p_currency in ('JPY', 'KRW', 'VND', 'CLP', 'BIF', 'DJF', 'GNF', 'ISK', 'KMF', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF') then 0
    when p_currency in ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') then 3
    when p_currency in ('CLF', 'UYW') then 4 else 2 end;
  value := p_value::numeric;
  if value <> round(value, precision_digits) then
    raise exception using errcode = '22023', message = 'Amount has more decimal places than the account currency supports.';
  end if;
  return value;
end $$;

create or replace function public.create_journal_trade_batch(p_user uuid, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior public.journal_trade_groups%rowtype; group_id uuid; item jsonb; account public.journal_accounts%rowtype;
  trade public.trades%rowtype; output jsonb := '[]'; entry numeric; exit numeric; opened timestamptz;
  closed timestamptz; net numeric; outcome text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_request::text, 0));
  select * into prior from public.journal_trade_groups where user_id = p_user and request_id = p_request;
  if found then
    if prior.payload <> p_payload then raise exception using errcode = '40001', message = 'This save ID was used for different trade details. Start a new save.'; end if;
    return prior.result;
  end if;
  if jsonb_typeof(p_payload->'accounts') is distinct from 'array' then raise exception using errcode = '22023', message = 'Choose destination accounts.'; end if;
  if jsonb_array_length(p_payload->'accounts') not between 1 and 20 then raise exception using errcode = '22023', message = 'Select between 1 and 20 accounts.'; end if;
  if (select count(distinct value->>'accountId') from jsonb_array_elements(p_payload->'accounts')) <> jsonb_array_length(p_payload->'accounts') then
    raise exception using errcode = '22023', message = 'Choose each account only once.';
  end if;
  if coalesce(p_payload->>'symbol', '') not in ('XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD') or coalesce(p_payload->>'direction', '') not in ('long', 'short') then
    raise exception using errcode = '22023', message = 'Choose a supported symbol and direction.';
  end if;
  if length(coalesce(p_payload->>'notes', '')) > 10000 or jsonb_typeof(p_payload->'setupTags') is distinct from 'array' or jsonb_array_length(p_payload->'setupTags') > 30 then
    raise exception using errcode = '22023', message = 'Check notes and setup tags.';
  end if;
  insert into public.journal_trade_groups(user_id, request_id, payload) values(p_user, p_request, p_payload) returning id into group_id;
  -- Stable account order avoids lock inversions between concurrent overlapping batches.
  for item in select value from jsonb_array_elements(p_payload->'accounts') order by value->>'accountId' loop
    select * into account from public.journal_accounts where id = (item->>'accountId')::uuid and user_id = p_user for update;
    if not found then raise exception using errcode = '42501', message = 'Destination account not found.'; end if;
    if account.broker_account_id is not null then raise exception using errcode = '22023', message = 'MT5 accounts receive trades automatically. Choose a manual journal account.'; end if;
    entry := coalesce(item->>'entryPrice', p_payload->>'entryPrice')::numeric;
    exit := (item->>'exitPrice')::numeric;
    opened := coalesce(item->>'openedAt', p_payload->>'openedAt')::timestamptz;
    closed := (item->>'closedAt')::timestamptz;
    net := case when item->>'netPnl' is null then null else public.journal_money(item->>'netPnl', account.currency) end;
    outcome := item->>'result';
    if net is not null then
      if outcome is not null and outcome <> (case when net > 0 then 'win' when net < 0 then 'loss' else 'breakeven' end) then
        raise exception using errcode = '22023', message = 'Result must match net P&L.';
      end if;
      outcome := case when net > 0 then 'win' when net < 0 then 'loss' else 'breakeven' end;
    end if;
    if entry is null or entry <= 0 or entry > 1e12 or entry::text in ('NaN', 'Infinity', '-Infinity') or (exit is not null and (exit <= 0 or exit > 1e12 or exit::text in ('NaN', 'Infinity', '-Infinity'))) then
      raise exception using errcode = '22023', message = 'Enter valid positive execution prices.';
    end if;
    if opened is null or not isfinite(opened) or opened > now() + interval '1 minute' or (closed is not null and (not isfinite(closed) or closed < opened or closed > now() + interval '1 minute')) then
      raise exception using errcode = '22023', message = 'Check entry and closing dates.';
    end if;
    if (closed is null and (outcome is not null or net is not null or exit is not null)) or (closed is not null and coalesce(outcome, '') not in ('win', 'loss', 'breakeven')) then
      raise exception using errcode = '22023', message = 'Closed trades need a result and closing time.';
    end if;
    insert into public.trades(user_id, journal_account_id, trade_group_id, symbol, direction, entry_price, exit_price, result, pnl_amount, pnl_percent, logged_at, closed_at, setup_tags, notes)
      values(p_user, account.id, group_id, p_payload->>'symbol', p_payload->>'direction', entry, exit, outcome, net,
        case when exit is null then null else round(((exit-entry)/entry)*100*(case when p_payload->>'direction' = 'short' then -1 else 1 end), 2) end,
        opened, closed, array(select jsonb_array_elements_text(p_payload->'setupTags')), coalesce(p_payload->>'notes', '')) returning * into trade;
    output := output || jsonb_build_array(to_jsonb(trade) || jsonb_build_object('pnl_amount_exact', trade.pnl_amount::text));
  end loop;
  output := jsonb_build_object('groupId', group_id, 'trades', output);
  update public.journal_trade_groups set result = output where id = group_id;
  return output;
end $$;

create or replace function public.mutate_journal_funds(p_user uuid, p_account uuid, p_request uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
<<funds_mutation>>
declare account public.journal_accounts%rowtype; prior public.journal_fund_requests%rowtype;
  opening public.journal_account_funds%rowtype; entry public.journal_cash_entries%rowtype;
  action text := p_payload->>'action'; kind text := p_payload->>'kind'; amount numeric; effective timestamptz;
  note text := coalesce(p_payload->>'note', ''); reason text := coalesce(p_payload->>'reason', ''); before_state jsonb; after_state jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_request::text, 0));
  select * into prior from public.journal_fund_requests where user_id = p_user and request_id = p_request;
  if found then
    if prior.payload <> p_payload or prior.account_id <> p_account then raise exception using errcode = '40001', message = 'This save ID was already used for different funds details.'; end if;
    return prior.result;
  end if;
  select * into account from public.journal_accounts where id = p_account and user_id = p_user for update;
  if not found then raise exception using errcode = '42501', message = 'Account not found.'; end if;
  if account.currency is null then raise exception using errcode = '22023', message = 'Set the account currency before recording funds.'; end if;
  select * into opening from public.journal_account_funds where account_id = p_account and user_id = p_user;
  if action not in ('set-opening', 'add', 'edit', 'void') or action is null then raise exception using errcode = '22023', message = 'Choose a valid funds action.'; end if;
  if length(note) > 1000 or length(reason) > 1000 then raise exception using errcode = '22023', message = 'Keep notes and correction reasons within 1,000 characters.'; end if;
  if action <> 'void' then
    amount := public.journal_money(p_payload->>'amount', account.currency);
    effective := (p_payload->>'effectiveAt')::timestamptz;
    if effective is null or not isfinite(effective) or effective > now() + interval '1 minute' then raise exception using errcode = '22023', message = 'Enter an effective date and time that is not in the future.'; end if;
  end if;
  if action = 'set-opening' then
    if coalesce(opening.version, 0) is distinct from (p_payload->>'expectedVersion')::integer then raise exception using errcode = '40001', message = 'Opening balance changed. Refresh before correcting it.'; end if;
    if opening.account_id is not null and length(trim(note)) = 0 then raise exception using errcode = '22023', message = 'Explain the opening balance correction.'; end if;
    if exists(select 1 from public.journal_cash_entries where account_id = p_account and voided_at is null and effective_at <= effective) then
      raise exception using errcode = '22023', message = 'Opening time must be before existing funds entries. Correct or void those entries first.';
    end if;
    if opening.account_id is not null then before_state := jsonb_build_object('amount', opening.amount::text, 'effectiveAt', opening.effective_at, 'note', opening.note); end if;
    insert into public.journal_account_funds(account_id, user_id, amount, effective_at, note)
      values(p_account, p_user, amount, effective, note)
      on conflict(account_id) do update set amount = excluded.amount, effective_at = excluded.effective_at, note = excluded.note, version = public.journal_account_funds.version + 1, updated_at = now()
      returning * into opening;
    after_state := jsonb_build_object('amount', opening.amount::text, 'effectiveAt', opening.effective_at, 'note', note);
    result := jsonb_build_object('version', opening.version);
    reason := note;
  else
    if opening.account_id is null then raise exception using errcode = '22023', message = 'Set an opening balance before recording account funds.'; end if;
    if action in ('edit', 'void') then
      select * into entry from public.journal_cash_entries where id = (p_payload->>'entryId')::uuid and account_id = p_account and user_id = p_user for update;
      if not found then raise exception using errcode = '42501', message = 'Funds entry not found.'; end if;
      if entry.voided_at is not null then raise exception using errcode = '40001', message = 'This entry was already voided. Refresh your history.'; end if;
      if entry.version is distinct from (p_payload->>'expectedVersion')::integer then raise exception using errcode = '40001', message = 'This entry changed. Refresh before editing it.'; end if;
      if length(trim(reason)) = 0 then raise exception using errcode = '22023', message = 'Add a correction reason.'; end if;
      before_state := jsonb_build_object('amount', entry.amount::text, 'effectiveAt', entry.effective_at, 'kind', entry.kind, 'note', entry.note, 'voidedAt', entry.voided_at);
    end if;
    if action = 'void' then
      update public.journal_cash_entries set voided_at = now(), version = version + 1, updated_at = now() where id = entry.id returning * into entry;
    else
      if kind is null or kind not in ('deposit', 'withdrawal', 'adjustment-increase', 'adjustment-decrease', 'fee') or amount <= 0 then raise exception using errcode = '22023', message = 'Choose a funds action and enter a positive amount.'; end if;
      if kind like 'adjustment-%' and length(trim(note)) = 0 then raise exception using errcode = '22023', message = 'Explain the balance adjustment.'; end if;
      if effective <= opening.effective_at then raise exception using errcode = '22023', message = 'Funds entries must be after the opening snapshot.'; end if;
      if kind in ('withdrawal', 'adjustment-decrease', 'fee') then amount := -amount; end if;
      if action = 'add' then
        insert into public.journal_cash_entries(user_id, account_id, kind, amount, effective_at, note) values(p_user, p_account, kind, amount, effective, note) returning * into entry;
      else
        update public.journal_cash_entries set kind = p_payload->>'kind', amount = funds_mutation.amount, effective_at = effective, note = funds_mutation.note, version = version + 1, updated_at = now() where id = entry.id returning * into entry;
      end if;
    end if;
    after_state := jsonb_build_object('amount', entry.amount::text, 'effectiveAt', entry.effective_at, 'kind', entry.kind, 'note', entry.note, 'voidedAt', entry.voided_at);
    result := jsonb_build_object('entryId', entry.id, 'version', entry.version);
  end if;
  insert into public.journal_fund_revisions(user_id, account_id, entry_id, operation, reason, before_state, after_state)
    values(p_user, p_account, case when action = 'set-opening' then null else entry.id end, action, reason, before_state, after_state);
  insert into public.journal_fund_requests(user_id, request_id, account_id, payload, result) values(p_user, p_request, p_account, p_payload, result);
  return result;
end $$;

create or replace function public.read_journal_funds(p_user uuid, p_account uuid, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account public.journal_accounts%rowtype; opening public.journal_account_funds%rowtype;
  funding numeric; fees numeric; adjustments numeric; pnl numeric; missing_pnl integer; missing_dates integer;
  entries jsonb; opening_json jsonb; entry_count integer; snapshot timestamptz := now();
begin
  select * into account from public.journal_accounts where user_id = p_user and id = p_account;
  if not found then raise exception using errcode = '42501', message = 'Account not found.'; end if;
  if p_offset < 0 or p_offset > 1000000 then raise exception using errcode = '22023', message = 'Invalid history page.'; end if;
  select * into opening from public.journal_account_funds where account_id = p_account and user_id = p_user;
  select coalesce(sum(amount) filter(where kind in ('deposit', 'withdrawal')), 0), -coalesce(sum(amount) filter(where kind = 'fee'), 0), coalesce(sum(amount) filter(where kind like 'adjustment-%'), 0)
    into funding, fees, adjustments from public.journal_cash_entries where user_id = p_user and account_id = p_account and voided_at is null and effective_at > opening.effective_at and effective_at <= snapshot;
  select coalesce(sum(pnl_amount), 0), count(*) filter(where pnl_amount is null) into pnl, missing_pnl
    from public.trades where user_id = p_user and journal_account_id = p_account and closed_at > opening.effective_at and closed_at <= snapshot;
  select count(*) into missing_dates from public.trades where user_id = p_user and journal_account_id = p_account and result is not null and closed_at is null;
  select count(*) into entry_count from public.journal_cash_entries where user_id = p_user and account_id = p_account;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'amount', e.amount::text, 'effectiveAt', e.effective_at, 'note', e.note, 'version', e.version, 'voidedAt', e.voided_at,
    'revisions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'operation', r.operation, 'reason', r.reason, 'createdAt', r.created_at, 'before', r.before_state, 'after', r.after_state) order by r.created_at, r.id), '[]') from public.journal_fund_revisions r where r.user_id = p_user and r.account_id = p_account and r.entry_id = e.id)) order by e.effective_at desc, e.id), '[]')
    into entries from (select * from public.journal_cash_entries where user_id = p_user and account_id = p_account order by effective_at desc, id limit 50 offset p_offset) e;
  if opening.account_id is not null then
    opening_json := jsonb_build_object('amount', opening.amount::text, 'effectiveAt', opening.effective_at, 'note', opening.note, 'version', opening.version,
      'revisions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'operation', r.operation, 'reason', r.reason, 'createdAt', r.created_at, 'before', r.before_state, 'after', r.after_state) order by r.created_at, r.id), '[]') from public.journal_fund_revisions r where r.user_id = p_user and r.account_id = p_account and r.entry_id is null));
  end if;
  return jsonb_build_object('currency', account.currency, 'syncedAccount', account.broker_account_id is not null, 'opening', opening_json,
    'summary', jsonb_build_object('balance', case when opening.account_id is null then null else (opening.amount + funding - fees + adjustments + pnl)::text end, 'netFunding', funding::text, 'fees', fees::text, 'adjustments', adjustments::text, 'netPnl', pnl::text,
      'missingPnl', missing_pnl, 'missingDates', missing_dates, 'complete', opening.account_id is not null and missing_pnl = 0 and missing_dates = 0 and account.broker_account_id is null, 'asOf', snapshot),
    'entries', entries, 'hasMore', entry_count > p_offset + 50);
end $$;

-- Every edit/deletion retains the monetary history, including sync updates.
create or replace function public.audit_journal_trade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    insert into public.journal_trade_revisions(user_id, account_id, trade_id, operation, before_state, after_state)
      values(old.user_id, old.journal_account_id, old.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.journal_trade_revisions(user_id, account_id, trade_id, operation, before_state)
      values(old.user_id, old.journal_account_id, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
  return new;
end $$;
drop trigger if exists audit_journal_trade on public.trades;
create trigger audit_journal_trade before update or delete on public.trades for each row execute function public.audit_journal_trade();

create or replace function public.update_journal_trade(p_user uuid, p_trade uuid, p_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare trade public.trades%rowtype; currency text; net numeric; entry numeric; exit numeric; closed timestamptz; outcome text;
begin
  select * into trade from public.trades where id = p_trade and user_id = p_user for update;
  if not found then raise exception using errcode = '42501', message = 'Trade not found.'; end if;
  if trade.revision is distinct from p_version then raise exception using errcode = '40001', message = 'This trade changed. Refresh its history before saving.'; end if;
  select a.currency into currency from public.journal_accounts a where a.id = trade.journal_account_id and a.user_id = p_user;
  entry := (p_payload->>'entryPrice')::numeric; exit := (p_payload->>'exitPrice')::numeric; closed := (p_payload->>'closedAt')::timestamptz;
  net := case when trade.broker_account_id is not null then (p_payload->>'netPnl')::numeric when p_payload->>'netPnl' is null then null else public.journal_money(p_payload->>'netPnl', currency) end;
  outcome := p_payload->>'result';
  if trade.broker_account_id is not null and (entry is distinct from trade.entry_price or exit is distinct from trade.exit_price or net is distinct from trade.pnl_amount or closed is distinct from trade.closed_at or outcome is distinct from trade.result) then
    raise exception using errcode = '22023', message = 'MT5 execution details are managed by broker sync. You can edit notes and tags.';
  end if;
  if length(coalesce(p_payload->>'notes', '')) > 10000 or jsonb_typeof(p_payload->'setupTags') is distinct from 'array' or jsonb_array_length(p_payload->'setupTags') > 30 then raise exception using errcode = '22023', message = 'Check notes and setup tags.'; end if;
  if trade.broker_account_id is not null then
    update public.trades set setup_tags = array(select jsonb_array_elements_text(p_payload->'setupTags')), notes = coalesce(p_payload->>'notes', ''), updated_at = now() where id = p_trade returning * into trade;
    return to_jsonb(trade) || jsonb_build_object('pnl_amount_exact', trade.pnl_amount::text);
  end if;
  if entry is null or entry <= 0 or entry > 1e12 or entry::text in ('NaN', 'Infinity', '-Infinity') or (exit is not null and (exit <= 0 or exit > 1e12 or exit::text in ('NaN', 'Infinity', '-Infinity'))) then raise exception using errcode = '22023', message = 'Enter valid positive prices.'; end if;
  if (closed is not null and (not isfinite(closed) or closed < trade.logged_at or closed > now() + interval '1 minute')) or (closed is null and (net is not null or outcome is not null or exit is not null)) or (closed is not null and coalesce(outcome, '') not in ('win', 'loss', 'breakeven')) then
    raise exception using errcode = '22023', message = 'Check the result and closing date.';
  end if;
  if net is not null and outcome is distinct from (case when net > 0 then 'win' when net < 0 then 'loss' else 'breakeven' end) then raise exception using errcode = '22023', message = 'Result must match net P&L.'; end if;
  update public.trades set entry_price = entry, exit_price = exit, closed_at = closed, pnl_amount = net, result = outcome,
    pnl_percent = case when exit is null then null else round(((exit-entry)/entry)*100*(case when direction = 'short' then -1 else 1 end), 2) end,
    setup_tags = array(select jsonb_array_elements_text(p_payload->'setupTags')), notes = coalesce(p_payload->>'notes', ''), updated_at = now()
    where id = p_trade returning * into trade;
  return to_jsonb(trade) || jsonb_build_object('pnl_amount_exact', trade.pnl_amount::text);
end $$;

-- Prevent changing a funded account's denomination through another server path.
create or replace function public.protect_journal_currency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.currency is not null and old.currency is distinct from new.currency and (exists(select 1 from public.journal_account_funds where account_id = old.id) or exists(select 1 from public.trades where journal_account_id = old.id and pnl_amount is not null)) then
    raise exception using errcode = '22023', message = 'Currency cannot change after monetary activity.';
  end if;
  return new;
end $$;
drop trigger if exists protect_journal_currency on public.journal_accounts;
create trigger protect_journal_currency before update of currency on public.journal_accounts for each row execute function public.protect_journal_currency();

alter table public.journal_trade_groups enable row level security;
alter table public.journal_account_funds enable row level security;
alter table public.journal_cash_entries enable row level security;
alter table public.journal_fund_revisions enable row level security;
alter table public.journal_fund_requests enable row level security;
alter table public.journal_trade_revisions enable row level security;
revoke all on public.journal_trade_groups, public.journal_account_funds, public.journal_cash_entries, public.journal_fund_revisions, public.journal_fund_requests, public.journal_trade_revisions from anon, authenticated;
grant all on public.journal_trade_groups, public.journal_account_funds, public.journal_cash_entries, public.journal_fund_revisions, public.journal_fund_requests, public.journal_trade_revisions to service_role;
grant usage on sequence public.journal_trade_revisions_id_seq to service_role;
revoke all on function public.journal_money(text, text), public.create_journal_trade_batch(uuid, uuid, jsonb), public.mutate_journal_funds(uuid, uuid, uuid, jsonb), public.read_journal_funds(uuid, uuid, integer), public.update_journal_trade(uuid, uuid, integer, jsonb), public.audit_journal_trade(), public.protect_journal_currency() from public, anon, authenticated;
grant execute on function public.create_journal_trade_batch(uuid, uuid, jsonb), public.mutate_journal_funds(uuid, uuid, uuid, jsonb), public.read_journal_funds(uuid, uuid, integer), public.update_journal_trade(uuid, uuid, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
