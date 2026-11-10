-- Apply after journal-account-funds.sql. Browser roles cannot read staged imports.
begin;
create table if not exists public.journal_import_batches (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid, new_account jsonb, filename text not null, file_hash text not null,
  options jsonb not null, opening jsonb, opening_version integer not null default 0,
  status text not null default 'preview' check (status in ('preview', 'committed', 'undone')),
  selection jsonb, result jsonb, created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours', committed_at timestamptz,
  unique(user_id,id), foreign key(user_id,account_id) references public.journal_accounts(user_id,id)
);
create table if not exists public.journal_import_rows (
  batch_id uuid not null references public.journal_import_batches(id) on delete cascade,
  row_number integer not null check (row_number between 2 and 1001),
  data jsonb, cells jsonb not null, diagnostics jsonb not null,
  status text not null check (status in ('ready','invalid','possible','duplicate')),
  imported boolean not null default false,
  trade_id uuid references public.trades(id) on delete set null,
  primary key(batch_id,row_number)
);
create table if not exists public.journal_setup_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  primary key(user_id,name)
);
create unique index if not exists journal_setup_tag_case_idx on public.journal_setup_tags(user_id,lower(name));
alter table public.trades add column if not exists import_batch_id uuid;
alter table public.trades add column if not exists import_source_id text;
alter table public.trades add column if not exists import_metadata jsonb;
alter table public.trades alter column entry_price drop not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='trades_import_owner_fk' and conrelid='public.trades'::regclass) then
    alter table public.trades add constraint trades_import_owner_fk foreign key(user_id,import_batch_id) references public.journal_import_batches(user_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='trades_missing_import_price' and conrelid='public.trades'::regclass) then
    alter table public.trades add constraint trades_missing_import_price check (entry_price is not null or (source='import' and import_batch_id is not null));
  end if;
end $$;
create unique index if not exists trades_import_source_idx on public.trades(journal_account_id,import_source_id) where import_source_id is not null;
create index if not exists trades_import_batch_idx on public.trades(import_batch_id);
create index if not exists journal_import_owner_idx on public.journal_import_batches(user_id,created_at desc);

create or replace function public.journal_import_duplicate(p_user uuid,p_account uuid,p_hash text,p_row integer,p_data jsonb)
returns text language sql stable set search_path='' as $$
  select case
    when exists(select 1 from public.journal_import_rows r join public.journal_import_batches b on b.id=r.batch_id
      where b.user_id=p_user and b.account_id=p_account and b.file_hash=p_hash and b.status='committed' and r.row_number=p_row and r.imported)
      or exists(select 1 from public.trades t where t.user_id=p_user and t.journal_account_id=p_account
        and p_data->>'sourceId' is not null and t.import_source_id=p_data->>'sourceId') then 'duplicate'
    when exists(select 1 from public.trades t where t.user_id=p_user and t.journal_account_id=p_account
      and t.symbol=p_data->>'symbol' and t.direction=p_data->>'direction'
      and t.logged_at=(p_data->>'timestamp')::timestamptz
      and t.entry_price is not distinct from (p_data->>'entryPrice')::numeric
      and t.exit_price is not distinct from (p_data->>'exitPrice')::numeric
      and t.result is not distinct from p_data->>'result'
      and t.pnl_amount is not distinct from (p_data->>'netPnl')::numeric) then 'possible'
    else null end;
$$;

create or replace function public.stage_journal_import(p_user uuid,p_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; account public.journal_accounts%rowtype; duplicate text;
begin
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 1000
    or length(p_payload::text)>10000000 then raise exception using errcode='22023',message='Import up to 1,000 trades from a CSV smaller than 2 MB.'; end if;
  if p_payload->>'accountId' is not null then
    select * into account from public.journal_accounts where id=(p_payload->>'accountId')::uuid and user_id=p_user;
    if not found then raise exception using errcode='42501',message='Account not found.'; end if;
    if account.broker_account_id is not null then raise exception using errcode='22023',message='Choose a manual account for CSV imports.'; end if;
  end if;
  delete from public.journal_import_batches where user_id=p_user and status='preview' and expires_at<now();
  insert into public.journal_import_batches(id,user_id,account_id,new_account,filename,file_hash,options,opening,opening_version)
    values(p_id,p_user,(p_payload->>'accountId')::uuid,nullif(p_payload->'newAccount','null'),p_payload->>'filename',p_payload->>'fileHash',p_payload->'options',nullif(p_payload->'opening','null'),coalesce((p_payload->>'openingVersion')::integer,0));
  for item in select value from jsonb_array_elements(p_payload->'rows') loop
    duplicate:=case when account.id is not null and item->>'status'<>'invalid' then public.journal_import_duplicate(p_user,account.id,p_payload->>'fileHash',(item->>'row')::integer,item->'trade') else null end;
    insert into public.journal_import_rows(batch_id,row_number,data,cells,diagnostics,status)
      values(p_id,(item->>'row')::integer,nullif(item->'trade','null'),item->'cells',jsonb_build_object('errors',item->'errors','warnings',item->'warnings'),case when item->>'status' in ('invalid','duplicate') then item->>'status' else coalesce(duplicate,item->>'status') end);
  end loop;
end $$;

create or replace function public.commit_journal_import(p_user uuid,p_batch uuid,p_rows integer[],p_keep integer[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.journal_import_batches%rowtype; account public.journal_accounts%rowtype;
  row public.journal_import_rows%rowtype; opening public.journal_account_funds%rowtype;
  v_selection jsonb; item jsonb; entry numeric; exit numeric; net numeric; opened timestamptz; closed timestamptz;
  outcome text; duplicate text; v_trade_id uuid; count_rows integer:=0; output jsonb; tag text;
begin
  select * into batch from public.journal_import_batches where id=p_batch and user_id=p_user for update;
  if not found then raise exception using errcode='42501',message='Import not found.'; end if;
  v_selection:=jsonb_build_object('rows',to_jsonb(array(select distinct unnest(p_rows) order by 1)),'keep',to_jsonb(array(select distinct unnest(p_keep) order by 1)));
  if batch.status='committed' then
    if batch.selection is distinct from v_selection then raise exception using errcode='40001',message='This batch was already imported with a different selection.'; end if;
    return batch.result;
  end if;
  if batch.status<>'preview' or batch.expires_at<now() then raise exception using errcode='40001',message='This preview expired or was undone. Preview the CSV again.'; end if;
  if cardinality(p_rows) not between 1 and 1000 or cardinality(p_rows)<>(select count(distinct n) from unnest(p_rows) n)
    or exists(select 1 from unnest(p_keep) n where not(n=any(p_rows))) then raise exception using errcode='22023',message='Choose unique, reviewed rows.'; end if;
  if batch.account_id is null then
    item:=batch.new_account;
    if item->>'brokerName' is null or item->>'accountNumber' is null or item->>'currency' is null then raise exception using errcode='22023',message='Complete the new account details.'; end if;
    insert into public.journal_accounts(user_id,broker_name,account_number,nickname,server,currency)
      values(p_user,item->>'brokerName',item->>'accountNumber',nullif(item->>'nickname',''),nullif(item->>'server',''),item->>'currency') returning * into account;
    update public.journal_import_batches set account_id=account.id where id=p_batch;
  else
    select * into account from public.journal_accounts where user_id=p_user and id=batch.account_id for update;
    if not found then raise exception using errcode='42501',message='Account not found.'; end if;
  end if;
  if account.broker_account_id is not null or account.currency is null then raise exception using errcode='22023',message='Choose a manual account with a known currency.'; end if;
  select * into opening from public.journal_account_funds where user_id=p_user and account_id=account.id;
  if coalesce(opening.version,0)<>batch.opening_version then raise exception using errcode='40001',message='The balance snapshot changed. Review a new preview before importing.'; end if;
  if batch.opening is not null then
    if opening.account_id is not null then raise exception using errcode='40001',message='An existing balance snapshot cannot be overwritten by an import.'; end if;
    perform public.mutate_journal_funds(p_user,account.id,p_batch,jsonb_build_object('action','set-opening','amount',batch.opening->>'amount','effectiveAt',batch.opening->>'effectiveAt','expectedVersion',0,'note','Balance confirmed during CSV import.'));
    select * into opening from public.journal_account_funds where user_id=p_user and account_id=account.id;
  end if;
  for row in select * from public.journal_import_rows where batch_id=p_batch and row_number=any(p_rows) order by row_number for update loop
    if row.status in ('invalid','duplicate') or row.data is null then raise exception using errcode='22023',message='Correct or skip invalid and previously imported rows.'; end if;
    item:=row.data;
    duplicate:=public.journal_import_duplicate(p_user,account.id,batch.file_hash,row.row_number,item);
    if duplicate='duplicate' then raise exception using errcode='40001',message='A selected row was already imported. Review a new preview.'; end if;
    if (duplicate='possible' or row.status='possible') and not(row.row_number=any(p_keep)) then raise exception using errcode='40001',message='A possible duplicate appeared. Review a new preview or explicitly keep it.'; end if;
    if item->>'symbol' not in ('XAUUSD','GBPUSD','US100','DJ30','BTCUSD') or item->>'direction' not in ('long','short') then raise exception using errcode='22023',message='Choose a supported symbol and direction.'; end if;
    entry:=(item->>'entryPrice')::numeric; exit:=(item->>'exitPrice')::numeric;
    opened:=(item->>'timestamp')::timestamptz; closed:=(item->>'closedAt')::timestamptz; outcome:=item->>'result';
    net:=case when item->>'netPnl' is null then null else public.journal_money(item->>'netPnl',account.currency) end;
    if (entry is not null and (entry<=0 or entry>1e12 or entry::text in ('NaN','Infinity','-Infinity')))
      or (exit is not null and (exit<=0 or exit>1e12 or exit::text in ('NaN','Infinity','-Infinity'))) then raise exception using errcode='22023',message='Check historical prices.'; end if;
    if opened is null or not isfinite(opened) or opened>now()+interval '1 minute'
      or (closed is not null and (not isfinite(closed) or closed>now()+interval '1 minute' or (item->>'dateMeaning'='entry' and closed<opened))) then raise exception using errcode='22023',message='Check historical dates.'; end if;
    if (outcome is null and (closed is not null or exit is not null or net is not null)) or (outcome is not null and outcome not in ('win','loss','breakeven'))
      or (net is not null and outcome is distinct from (case when net>0 then 'win' when net<0 then 'loss' else 'breakeven' end)) then raise exception using errcode='22023',message='Check the historical result and cash amount.'; end if;
    if jsonb_typeof(item->'setupTags') is distinct from 'array' or jsonb_array_length(item->'setupTags')>30 or length(coalesce(item->>'notes',''))>10000 or length(coalesce(item->>'sourceId',''))>256 then raise exception using errcode='22023',message='Check notes, source IDs and tags.'; end if;
    if batch.opening->>'mode'='starting' and opening.effective_at>=opened then raise exception using errcode='22023',message='Starting capital must be dated before the imported trades.'; end if;
    if net is not null and closed is not null and item->>'closedPrecision'='date' and opening.account_id is not null
      and (closed at time zone (item->>'timezone'))::date=(opening.effective_at at time zone (item->>'timezone'))::date then raise exception using errcode='22023',message='A date-only cash result falls on the balance snapshot day. Supply its closing time or choose a different snapshot date.'; end if;
    insert into public.trades(user_id,source,journal_account_id,import_batch_id,import_source_id,import_metadata,symbol,direction,entry_price,exit_price,result,pnl_amount,pnl_percent,logged_at,closed_at,setup_tags,notes)
      values(p_user,'import',account.id,p_batch,item->>'sourceId',item-'notes'-'setupTags'-'netPnl'-'entryPrice'-'exitPrice',item->>'symbol',item->>'direction',entry,exit,outcome,net,
      case when entry is null or exit is null then null else round(((exit-entry)/entry)*100*(case when item->>'direction'='short' then -1 else 1 end),2) end,
      opened,closed,array(select jsonb_array_elements_text(item->'setupTags')),coalesce(item->>'notes','')) returning id into v_trade_id;
    update public.journal_import_rows set imported=true,trade_id=v_trade_id where batch_id=p_batch and row_number=row.row_number;
    for tag in select jsonb_array_elements_text(item->'setupTags') loop
      if length(tag) not between 1 and 80 then raise exception using errcode='22023',message='Check setup tags.'; end if;
      insert into public.journal_setup_tags(user_id,name) values(p_user,tag) on conflict do nothing;
    end loop;
    count_rows:=count_rows+1;
  end loop;
  if count_rows<>cardinality(p_rows) then raise exception using errcode='22023',message='One or more selected rows were not found.'; end if;
  output:=jsonb_build_object('id',p_batch,'accountId',account.id,'count',count_rows,'skipped',(select count(*) from public.journal_import_rows where batch_id=p_batch)-count_rows,
    'from',(select min(data->>'timestamp') from public.journal_import_rows where batch_id=p_batch and imported), 'to',(select max(data->>'timestamp') from public.journal_import_rows where batch_id=p_batch and imported));
  update public.journal_import_batches set status='committed',committed_at=now(),selection=v_selection,result=output where id=p_batch;
  return output;
end $$;

create or replace function public.undo_journal_import(p_user uuid,p_batch uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.journal_import_batches%rowtype; removable integer; retained integer; removed integer; result jsonb;
begin
  select * into batch from public.journal_import_batches where id=p_batch and user_id=p_user for update;
  if not found then raise exception using errcode='42501',message='Import not found.'; end if;
  if batch.status='undone' then return jsonb_build_object('removed',0,'retained',(select count(*) from public.trades where import_batch_id=p_batch)); end if;
  if batch.status<>'committed' then raise exception using errcode='22023',message='This import has not been committed.'; end if;
  perform 1 from public.journal_accounts where id=batch.account_id and user_id=p_user for update;
  perform 1 from public.trades where import_batch_id=p_batch and user_id=p_user order by id for update;
  select count(*) filter(where revision=1),count(*) filter(where revision>1) into removable,retained from public.trades where import_batch_id=p_batch and user_id=p_user;
  if removable<>p_expected then raise exception using errcode='40001',message='These imported trades changed. Review the undo counts again.'; end if;
  delete from public.trades where import_batch_id=p_batch and user_id=p_user and revision=1;
  get diagnostics removed=row_count;
  update public.journal_import_batches set status='undone' where id=p_batch;
  result:=jsonb_build_object('removed',removed,'retained',retained);
  return result;
end $$;

alter table public.journal_import_batches enable row level security;
alter table public.journal_import_rows enable row level security;
alter table public.journal_setup_tags enable row level security;
revoke all on public.journal_import_batches,public.journal_import_rows,public.journal_setup_tags from anon,authenticated;
grant all on public.journal_import_batches,public.journal_import_rows,public.journal_setup_tags to service_role;
revoke all on function public.journal_import_duplicate(uuid,uuid,text,integer,jsonb),public.stage_journal_import(uuid,uuid,jsonb),public.commit_journal_import(uuid,uuid,integer[],integer[]),public.undo_journal_import(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.journal_import_duplicate(uuid,uuid,text,integer,jsonb),public.stage_journal_import(uuid,uuid,jsonb),public.commit_journal_import(uuid,uuid,integer[],integer[]),public.undo_journal_import(uuid,uuid,integer) to service_role;
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
  if (entry is null and trade.import_batch_id is null) or entry <= 0 or entry > 1e12 or entry::text in ('NaN', 'Infinity', '-Infinity') or (exit is not null and (exit <= 0 or exit > 1e12 or exit::text in ('NaN', 'Infinity', '-Infinity'))) then raise exception using errcode = '22023', message = 'Enter valid positive prices.'; end if;
  if (closed is not null and (not isfinite(closed) or closed < trade.logged_at or closed > now() + interval '1 minute')) or (closed is null and (net is not null or outcome is not null or exit is not null) and not(trade.import_batch_id is not null and trade.closed_at is null and net is not distinct from trade.pnl_amount and outcome is not distinct from trade.result and exit is not distinct from trade.exit_price)) or (closed is not null and coalesce(outcome, '') not in ('win', 'loss', 'breakeven')) then
    raise exception using errcode = '22023', message = 'Check the result and closing date.';
  end if;
  if net is not null and outcome is distinct from (case when net > 0 then 'win' when net < 0 then 'loss' else 'breakeven' end) then raise exception using errcode = '22023', message = 'Result must match net P&L.'; end if;
  update public.trades set import_metadata = case when trade.import_batch_id is not null and closed is distinct from trade.closed_at then trade.import_metadata || jsonb_build_object('closedPrecision','time') else trade.import_metadata end, entry_price = entry, exit_price = exit, closed_at = closed, pnl_amount = net, result = outcome,
    pnl_percent = case when entry is null or exit is null then null else round(((exit-entry)/entry)*100*(case when direction = 'short' then -1 else 1 end), 2) end,
    setup_tags = array(select jsonb_array_elements_text(p_payload->'setupTags')), notes = coalesce(p_payload->>'notes', ''), updated_at = now()
    where id = p_trade returning * into trade;
  return to_jsonb(trade) || jsonb_build_object('pnl_amount_exact', trade.pnl_amount::text);
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
    from public.trades where user_id = p_user and journal_account_id = p_account and closed_at > opening.effective_at and closed_at <= snapshot and not coalesce((import_metadata->>'closedPrecision'='date' and (closed_at at time zone (import_metadata->>'timezone'))::date=(opening.effective_at at time zone (import_metadata->>'timezone'))::date),false);
  select count(*) into missing_dates from public.trades where user_id = p_user and journal_account_id = p_account and result is not null and (closed_at is null or coalesce((import_metadata->>'closedPrecision'='date' and (closed_at at time zone (import_metadata->>'timezone'))::date=(opening.effective_at at time zone (import_metadata->>'timezone'))::date),false));
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

notify pgrst,'reload schema';
commit;
