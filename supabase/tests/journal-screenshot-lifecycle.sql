-- Disposable local database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  assert to_regclass('public.journal_trade_screenshots') is not null,
    'Screenshot reservations must exist before enabling clipboard uploads';
end $$;

do $$
declare u uuid:=gen_random_uuid(); i integer;
begin
  insert into auth.users(id,email) values(u,'rate-'||u||'@example.test');
  for i in 1..30 loop perform public.check_journal_screenshot_upload_rate(u); end loop;
  begin
    perform public.check_journal_screenshot_upload_rate(u);
    raise exception '31st image decode attempt was accepted';
  exception when raise_exception then if sqlerrm<>'SCREENSHOT_RATE_LIMIT' then raise; end if; end;
  update public.journal_screenshot_rate set window_started_at=clock_timestamp()-interval '61 seconds' where user_id=u;
  perform public.check_journal_screenshot_upload_rate(u);
  assert (select uploads=1 from public.journal_screenshot_rate where user_id=u),'rate window did not reset';
end $$;

do $$
declare u uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid(); r jsonb; s jsonb; s2 jsonb; s3 jsonb; result jsonb; j record; n int;
begin
  insert into auth.users(id,email) values(u,'screenshots-'||u||'@example.test'),(other_owner,'screenshots-'||other_owner||'@example.test');
  insert into public.trades(id,user_id,symbol,direction,entry_price) values(t,u,'XAUUSD','long',2600);
  r:=public.reserve_journal_screenshot(u,t,op,repeat('a',64),'image/png',100,10,10);
  assert r->>'status'='reserved','first upload did not reserve'; s:=r->'screenshot';
  assert s->>'object_path'=u::text||'/'||t::text||'/'||(s->>'id'),'immutable path missing';
  r:=public.reserve_journal_screenshot(u,t,op,repeat('a',64),'image/png',100,10,10);
  assert r->>'status'='pending','duplicate operation obtained a second writer';
  assert (select count(*)=1 from public.journal_trade_screenshots where trade_id=t),'retry duplicated reservation';
  begin
    perform public.reserve_journal_screenshot(u,t,op,repeat('b',64),'image/png',100,10,10);
    raise exception 'different bytes reused operation';
  exception when raise_exception then if sqlerrm<>'SCREENSHOT_OPERATION_CONFLICT' then raise; end if; end;
  begin
    perform public.reserve_journal_screenshot(other_owner,t,gen_random_uuid(),repeat('a',64),'image/png',100,10,10);
    raise exception 'other owner reserved a slot';
  exception when raise_exception then if sqlerrm<>'TRADE_NOT_FOUND' then raise; end if; end;
  r:=public.finalize_journal_screenshot(u,t,(s->>'id')::uuid,(s->>'upload_token')::uuid);
  assert r->>'status'='ready','upload did not finalize';
  r:=public.reserve_journal_screenshot(u,t,op,repeat('a',64),'image/png',100,10,10);
  assert r->>'status'='ready' and r->'screenshot'->>'id'=s->>'id','lost-response retry not idempotent';
  r:=public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('b',64),'image/webp',100,10,10); s2:=r->'screenshot';
  r:=public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('c',64),'image/jpeg',100,10,10); s3:=r->'screenshot';
  begin
    perform public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('d',64),'image/png',100,10,10);
    raise exception 'fourth pending upload accepted';
  exception when raise_exception then if sqlerrm<>'SCREENSHOT_LIMIT' then raise; end if; end;
  perform public.delete_journal_screenshot(u,t,(s->>'id')::uuid);
  perform public.delete_journal_screenshot(u,t,(s->>'id')::uuid);
  assert (select state='deleting' from public.journal_trade_screenshots where id=(s->>'id')::uuid),'delete still visible';
  assert (select count(*)=1 from public.journal_screenshot_cleanup where object_path=s->>'object_path'),'duplicate cleanup jobs';
  r:=public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('d',64),'image/png',100,10,10);
  assert r->'screenshot'->>'slot'=s->>'slot' and r->'screenshot'->>'object_path'<>s->>'object_path','slot reuse overwrote old path';
  -- Expired reservation is rejected durably, freeing capacity without a rollback.
  update public.journal_trade_screenshots set upload_expires_at=clock_timestamp()-interval '1 second' where id=(s2->>'id')::uuid;
  result:=public.finalize_journal_screenshot(u,t,(s2->>'id')::uuid,(s2->>'upload_token')::uuid);
  assert result->>'status'='expired','expired finalize accepted';
  assert exists(select 1 from public.journal_screenshot_cleanup where object_path=s2->>'object_path'),'expired upload has no recovery';
  -- Single-trade and arbitrary bulk deletion paths share this database trigger.
  perform public.write_journal_trade(u,'delete',t);
  assert not exists(select 1 from public.journal_trade_screenshots where trade_id=t and state<>'deleting'),'trade deletion left live attachments';
  assert (select count(*)=4 from public.journal_screenshot_cleanup where object_path like u::text||'/'||t::text||'/%'),'trade deletion lost paths';
  result:=public.finalize_journal_screenshot(u,t,(s3->>'id')::uuid,(s3->>'upload_token')::uuid);
  assert result->>'status'='cancelled','late upload finalized after trade deletion';
  assert not exists(select 1 from public.claim_journal_screenshot_cleanup(50) where object_path=s3->>'object_path'),'in-flight image cleaned before lease grace';
  -- Force due fixture jobs, then verify claiming, stale receipts, and retry backoff.
  update public.journal_screenshot_cleanup set available_at=clock_timestamp()-interval '1 second',claimed_until=null where object_path like u::text||'/%';
  select * into j from public.claim_journal_screenshot_cleanup(1);
  assert j.id is not null,'cleanup not claimable';
  assert not public.finish_journal_screenshot_cleanup(j.id,gen_random_uuid(),true),'stale worker completed another claim';
  assert public.finish_journal_screenshot_cleanup(j.id,j.claim_token,false),'failure not recorded';
  assert (select available_at>clock_timestamp() and completed_at is null from public.journal_screenshot_cleanup where id=j.id),'failed cleanup did not back off';
  update public.journal_screenshot_cleanup set available_at=clock_timestamp()-interval '1 second' where id=j.id;
  select * into j from public.claim_journal_screenshot_cleanup(1);
  assert public.finish_journal_screenshot_cleanup(j.id,j.claim_token,true),'completion not recorded';
  assert (select completed_at is not null from public.journal_screenshot_cleanup where id=j.id),'completion disappeared';
  select count(*) into n from public.journal_trade_screenshots where user_id=u;
  delete from auth.users where id=u;
  assert (select count(*)=n from public.journal_trade_screenshots where user_id=u),'Auth cascade erased recovery paths';
  assert exists(select 1 from public.journal_screenshot_cleanup where object_path like u::text||'/%'),'Auth cascade erased cleanup jobs';
end $$;

do $$
declare u uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); r jsonb; s jsonb;
begin
  insert into auth.users(id,email) values(u,'freeze-'||u||'@example.test');
  insert into public.trades(id,user_id,symbol,direction,entry_price) values(t,u,'EURUSD','long',1.1);
  r:=public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('e',64),'image/png',100,10,10); s:=r->'screenshot';
  perform public.prepare_journal_user_deletion(u);
  assert (select state='deleting' from public.journal_trade_screenshots where id=(s->>'id')::uuid),'pending user deletion did not freeze attachments';
  r:=public.finalize_journal_screenshot(u,t,(s->>'id')::uuid,(s->>'upload_token')::uuid);
  assert r->>'status'='cancelled','freeze allowed finalization';
  begin
    perform public.reserve_journal_screenshot(u,t,gen_random_uuid(),repeat('f',64),'image/png',100,10,10);
    raise exception 'freeze allowed reservation';
  exception when raise_exception then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  delete from auth.users where id=u;
  assert exists(select 1 from public.journal_trade_screenshots where id=(s->>'id')::uuid),'deleted user lost upload tombstone';
end $$;

do $$ begin
  assert not has_table_privilege('authenticated','public.journal_trade_screenshots','SELECT'),'browser can read attachment metadata';
  assert not has_table_privilege('anon','public.journal_screenshot_cleanup','SELECT'),'anonymous can read cleanup paths';
  assert not has_function_privilege('authenticated','public.reserve_journal_screenshot(uuid,uuid,uuid,text,text,integer,integer,integer)','EXECUTE'),'browser can reserve without app authorization';
  assert not has_function_privilege('anon','public.claim_journal_screenshot_cleanup(integer)','EXECUTE'),'anonymous can claim cleanup';
end $$;
rollback;
\echo PASS screenshot reservation, retry, capacity, ownership, deletion, lease, cleanup, freeze, and role assertions
