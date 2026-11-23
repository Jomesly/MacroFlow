-- Apply after journal-screenshots.sql and account-management-journal-compat.sql.
-- Forward-only and rerunnable. Keep image intake disabled until legacy backfill
-- has completed and the cleanup worker is scheduled. Storage metadata is read-only.
begin;
set local lock_timeout='5s';

-- Deliberately no cascading parent foreign keys: these paths must outlive Auth
-- and trade deletion so the Storage API can finish physical cleanup afterwards.
create table if not exists public.journal_trade_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  trade_id uuid not null,
  slot integer not null check (slot between 0 and 2),
  object_path text not null unique,
  client_upload_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  byte_size integer not null check (byte_size between 1 and 3145728),
  width integer check (width>0), height integer check (height>0),
  state text not null check (state in ('uploading','ready','deleting')),
  upload_token uuid not null default gen_random_uuid(),
  upload_expires_at timestamptz not null default clock_timestamp()+interval '90 seconds',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(user_id,trade_id,client_upload_id),
  check (width is null or height is null or width::bigint*height<=24000000)
);
create unique index if not exists journal_screenshot_active_slot on public.journal_trade_screenshots(user_id,trade_id,slot)
  where state in ('uploading','ready');
create index if not exists journal_screenshot_expiring on public.journal_trade_screenshots(upload_expires_at) where state='uploading';

create table if not exists public.journal_screenshot_cleanup (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  available_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  claim_token uuid,
  claimed_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists journal_screenshot_cleanup_due on public.journal_screenshot_cleanup(available_at) where completed_at is null;
create table if not exists public.journal_screenshot_rate (
  user_id uuid primary key, window_started_at timestamptz not null, uploads integer not null
);
create table if not exists public.journal_screenshot_maintenance (
  name text primary key, cursor text not null default '', completed_at timestamptz
);
insert into public.journal_screenshot_maintenance(name) values('legacy-backfill'),('orphan-scan') on conflict do nothing;

alter table public.journal_trade_screenshots enable row level security;
alter table public.journal_screenshot_cleanup enable row level security;
alter table public.journal_screenshot_rate enable row level security;
alter table public.journal_screenshot_maintenance enable row level security;
revoke all on public.journal_trade_screenshots,public.journal_screenshot_cleanup,public.journal_screenshot_rate,public.journal_screenshot_maintenance from public,anon,authenticated;
grant select,insert,update,delete on public.journal_trade_screenshots,public.journal_screenshot_cleanup,public.journal_screenshot_rate,public.journal_screenshot_maintenance to service_role;

-- Internal helper. Callers serialize by owner before touching attachment rows.
create or replace function public.queue_journal_screenshot_cleanup(p_image_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.journal_trade_screenshots; due timestamptz;
begin
  select * into s from public.journal_trade_screenshots where id=p_image_id for update;
  if not found then return; end if;
  due:=case when s.state='ready' then clock_timestamp()
    else greatest(clock_timestamp(),s.upload_expires_at+interval '60 seconds') end;
  update public.journal_trade_screenshots set state='deleting',updated_at=clock_timestamp() where id=s.id and state<>'deleting';
  insert into public.journal_screenshot_cleanup(object_path,available_at) values(s.object_path,due)
    on conflict(object_path) do nothing;
end $$;

-- Separate attempt gate runs before image decoding. Retries and malformed
-- files consume the same bounded budget as new reservations.
create or replace function public.check_journal_screenshot_upload_rate(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  perform public.lock_journal_owner(p_user_id);
  if not exists(select 1 from auth.users where id=p_user_id)
    or not exists(select 1 from public.journal_access where user_id=p_user_id and status='active') then
    raise exception 'TRADE_NOT_FOUND';
  end if;
  insert into public.journal_screenshot_rate(user_id,window_started_at,uploads) values(p_user_id,clock_timestamp(),1)
    on conflict(user_id) do update set
      uploads=case when journal_screenshot_rate.window_started_at<=clock_timestamp()-interval '1 minute' then 1 else journal_screenshot_rate.uploads+1 end,
      window_started_at=case when journal_screenshot_rate.window_started_at<=clock_timestamp()-interval '1 minute' then clock_timestamp() else journal_screenshot_rate.window_started_at end
    returning uploads into v_count;
  if v_count>30 then raise exception 'SCREENSHOT_RATE_LIMIT'; end if;
end $$;

create or replace function public.reserve_journal_screenshot(
  p_user_id uuid,p_trade_id uuid,p_client_upload_id uuid,p_content_hash text,p_mime_type text,
  p_byte_size integer,p_width integer,p_height integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.journal_trade_screenshots; v_id uuid:=gen_random_uuid(); v_slot integer; expired record;
begin
  perform public.lock_journal_owner(p_user_id);
  if not exists(select 1 from auth.users where id=p_user_id)
    or not exists(select 1 from public.journal_access where user_id=p_user_id and status='active')
    or not exists(select 1 from public.trades where id=p_trade_id and user_id=p_user_id) then
    raise exception 'TRADE_NOT_FOUND';
  end if;
  if p_client_upload_id is null or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_mime_type is null or p_mime_type not in ('image/png','image/jpeg','image/webp')
    or p_byte_size is null or p_byte_size not between 1 and 3145728
    or p_width is null or p_height is null or p_width<1 or p_height<1
    or p_width::bigint*p_height>24000000 then raise exception 'INVALID_SCREENSHOT'; end if;
  select * into s from public.journal_trade_screenshots
    where user_id=p_user_id and trade_id=p_trade_id and client_upload_id=p_client_upload_id;
  if found then
    if s.content_hash<>p_content_hash then raise exception 'SCREENSHOT_OPERATION_CONFLICT'; end if;
    if s.state='ready' then return jsonb_build_object('status','ready','screenshot',to_jsonb(s)); end if;
    if s.state='deleting' then return jsonb_build_object('status','cancelled'); end if;
    if s.upload_expires_at<=clock_timestamp() then
      perform public.queue_journal_screenshot_cleanup(s.id);
      return jsonb_build_object('status','expired');
    end if;
    return jsonb_build_object('status','pending');
  end if;
  -- Expired reservations stop occupying a slot, but their paths remain fenced.
  for expired in select id from public.journal_trade_screenshots where user_id=p_user_id and trade_id=p_trade_id
    and state='uploading' and upload_expires_at<=clock_timestamp() loop
    perform public.queue_journal_screenshot_cleanup(expired.id);
  end loop;
  select x into v_slot from generate_series(0,2) x where not exists(
    select 1 from public.journal_trade_screenshots where user_id=p_user_id and trade_id=p_trade_id and slot=x and state in ('uploading','ready'))
    order by x limit 1;
  if v_slot is null then raise exception 'SCREENSHOT_LIMIT'; end if;
  insert into public.journal_trade_screenshots(id,user_id,trade_id,slot,object_path,client_upload_id,content_hash,mime_type,byte_size,width,height,state)
    values(v_id,p_user_id,p_trade_id,v_slot,p_user_id::text||'/'||p_trade_id::text||'/'||v_id::text,
      p_client_upload_id,p_content_hash,p_mime_type,p_byte_size,p_width,p_height,'uploading') returning * into s;
  return jsonb_build_object('status','reserved','screenshot',to_jsonb(s));
end $$;

create or replace function public.finalize_journal_screenshot(p_user_id uuid,p_trade_id uuid,p_image_id uuid,p_upload_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.journal_trade_screenshots;
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  -- Raw owner lock allows a cancelled result + durable cleanup after the owner is frozen/deleted.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,731));
  select * into s from public.journal_trade_screenshots where id=p_image_id and user_id=p_user_id and trade_id=p_trade_id;
  if not found or s.upload_token is distinct from p_upload_token then raise exception 'TRADE_NOT_FOUND'; end if;
  if s.state='deleting' then return jsonb_build_object('status','cancelled'); end if;
  if not exists(select 1 from auth.users where id=p_user_id)
    or not exists(select 1 from public.trades where id=p_trade_id and user_id=p_user_id)
    or not exists(select 1 from public.journal_access where user_id=p_user_id and status='active' and deletion_requested_at is null) then
    perform public.queue_journal_screenshot_cleanup(s.id);
    return jsonb_build_object('status','cancelled');
  end if;
  if s.state='ready' then return jsonb_build_object('status','ready','screenshot',to_jsonb(s)); end if;
  if s.upload_expires_at<=clock_timestamp() then
    perform public.queue_journal_screenshot_cleanup(s.id);
    return jsonb_build_object('status','expired');
  end if;
  update public.journal_trade_screenshots set state='ready',updated_at=clock_timestamp() where id=s.id returning * into s;
  return jsonb_build_object('status','ready','screenshot',to_jsonb(s));
end $$;

create or replace function public.abort_journal_screenshot(p_user_id uuid,p_trade_id uuid,p_image_id uuid,p_upload_token uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_user_id is null then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,731));
  if exists(select 1 from public.journal_trade_screenshots where id=p_image_id and user_id=p_user_id and trade_id=p_trade_id
    and upload_token=p_upload_token and state='uploading') then
    perform public.queue_journal_screenshot_cleanup(p_image_id);
  end if;
end $$;

create or replace function public.delete_journal_screenshot(p_user_id uuid,p_trade_id uuid,p_image_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_journal_owner(p_user_id);
  if not exists(select 1 from public.trades where id=p_trade_id and user_id=p_user_id) then raise exception 'TRADE_NOT_FOUND'; end if;
  if not exists(select 1 from public.journal_trade_screenshots where id=p_image_id and user_id=p_user_id and trade_id=p_trade_id) then
    raise exception 'TRADE_NOT_FOUND';
  end if;
  perform public.queue_journal_screenshot_cleanup(p_image_id);
end $$;

-- All delete sources (including CSV undo and Auth cascades) pass this trigger.
create or replace function public.delete_trade_screenshot_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare s record;
begin
  if old.user_id is null then return old; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(old.user_id::text,731)) then
    raise exception 'JOURNAL_WRITE_BUSY' using errcode='55P03';
  end if;
  for s in select id from public.journal_trade_screenshots where user_id=old.user_id and trade_id=old.id and state<>'deleting' loop
    perform public.queue_journal_screenshot_cleanup(s.id);
  end loop;
  return old;
end $$;
drop trigger if exists cleanup_trade_screenshots on public.trades;
create trigger cleanup_trade_screenshots after delete on public.trades for each row execute function public.delete_trade_screenshot_cleanup();

create or replace function public.delete_user_screenshot_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_owner uuid; s record;
begin
  if tg_table_schema='auth' then v_owner:=old.id;
  else
    if new.deletion_requested_at is null then return new; end if;
    v_owner:=new.user_id;
  end if;
  -- Direct legacy updates may already hold a parent row lock; fail fast instead
  -- of inverting the normal owner-before-row ordering.
  if not pg_try_advisory_xact_lock(hashtextextended(v_owner::text,731)) then
    raise exception 'JOURNAL_WRITE_BUSY' using errcode='55P03';
  end if;
  for s in select id from public.journal_trade_screenshots where user_id=v_owner and state<>'deleting' loop
    perform public.queue_journal_screenshot_cleanup(s.id);
  end loop;
  delete from public.journal_screenshot_rate where user_id=v_owner;
  if tg_table_schema='auth' then return old; end if;
  return new;
end $$;
drop trigger if exists cleanup_user_screenshots on auth.users;
create trigger cleanup_user_screenshots before delete on auth.users for each row execute function public.delete_user_screenshot_cleanup();
drop trigger if exists freeze_user_screenshots on public.journal_access;
create trigger freeze_user_screenshots after insert or update of deletion_requested_at on public.journal_access
  for each row execute function public.delete_user_screenshot_cleanup();

create or replace function public.claim_journal_screenshot_cleanup(p_limit integer default 50)
returns table(id uuid,object_path text,claim_token uuid,attempts integer)
language sql security definer set search_path='' as $$
  with candidates as (
    select c.id from public.journal_screenshot_cleanup c where c.completed_at is null
      and c.available_at<=clock_timestamp() and (c.claimed_until is null or c.claimed_until<=clock_timestamp())
    order by c.available_at,c.id for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.journal_screenshot_cleanup c set claim_token=gen_random_uuid(),claimed_until=clock_timestamp()+interval '2 minutes',attempts=c.attempts+1
  from candidates where c.id=candidates.id returning c.id,c.object_path,c.claim_token,c.attempts;
$$;

create or replace function public.finish_journal_screenshot_cleanup(p_job_id uuid,p_claim_token uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.journal_screenshot_cleanup set
    completed_at=case when p_success then clock_timestamp() else null end,
    available_at=case when p_success then available_at else clock_timestamp()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer*5)) end,
    claimed_until=null,claim_token=null
  where id=p_job_id and claim_token=p_claim_token and claimed_until>clock_timestamp();
  return found;
end $$;

-- A durable cursor bounds each metadata scan, including buckets with many live
-- screenshots. Only read Storage metadata; physical deletion is done by the worker.
create or replace function public.reconcile_journal_screenshots(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,100),500)); s record; o record;
  v_expired integer:=0; v_orphans integer:=0; v_cursor text; v_count integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('journal-screenshot-reconcile',731)) then
    return jsonb_build_object('expired',0,'orphans',0);
  end if;
  for s in select a.id,a.user_id from public.journal_trade_screenshots a where a.state<>'deleting' and (
    (a.state='uploading' and a.upload_expires_at<=clock_timestamp())
    or not exists(select 1 from public.trades t where t.id=a.trade_id and t.user_id=a.user_id)
    or not exists(select 1 from auth.users u where u.id=a.user_id)
    or exists(select 1 from public.journal_access j where j.user_id=a.user_id and j.deletion_requested_at is not null))
    order by a.upload_expires_at,a.id limit v_limit loop
    if pg_try_advisory_xact_lock(hashtextextended(s.user_id::text,731)) then
      -- Recheck after acquiring the lock: a concurrent finalization may have won.
      if exists(select 1 from public.journal_trade_screenshots a where a.id=s.id and a.state<>'deleting' and (
        (a.state='uploading' and a.upload_expires_at<=clock_timestamp())
        or not exists(select 1 from public.trades t where t.id=a.trade_id and t.user_id=a.user_id)
        or not exists(select 1 from auth.users u where u.id=a.user_id)
        or exists(select 1 from public.journal_access j where j.user_id=a.user_id and j.deletion_requested_at is not null))) then
        perform public.queue_journal_screenshot_cleanup(s.id); v_expired:=v_expired+1;
      end if;
    end if;
  end loop;
  -- Do not classify preexisting images as orphans until their inventory/backfill
  -- has completed. Old intake must stay disabled throughout that migration step.
  if not exists(select 1 from public.journal_screenshot_maintenance where name='legacy-backfill' and completed_at is not null) then
    return jsonb_build_object('expired',v_expired,'orphans',0);
  end if;
  select cursor into v_cursor from public.journal_screenshot_maintenance where name='orphan-scan' for update;
  for o in select name,created_at from storage.objects where bucket_id='journal-screenshots' and name>v_cursor order by name limit v_limit loop
    v_count:=v_count+1; v_cursor:=o.name;
    if o.created_at>clock_timestamp()-interval '10 minutes' then continue; end if;
    if not exists(select 1 from public.journal_trade_screenshots where object_path=o.name and state in ('uploading','ready')) then
      -- An already-completed job may see a very late upload. Reopen it; immutable
      -- paths ensure this can never remove the replacement in the same slot.
      insert into public.journal_screenshot_cleanup(object_path) values(o.name)
        on conflict(object_path) do update set completed_at=null,available_at=clock_timestamp(),claim_token=null,claimed_until=null
        where journal_screenshot_cleanup.completed_at is not null;
      if found then v_orphans:=v_orphans+1; end if;
    end if;
  end loop;
  update public.journal_screenshot_maintenance set cursor=case when v_count<v_limit then '' else v_cursor end where name='orphan-scan';
  return jsonb_build_object('expired',v_expired,'orphans',v_orphans);
end $$;

-- With old intake disabled, import valid legacy fixed-slot paths without moving
-- bytes. Returns a bounded page plus invalid paths for the operator's inventory.
create or replace function public.backfill_journal_screenshots(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,100),500)); o record;
  v_cursor text; v_count integer:=0; v_added integer:=0; v_invalid jsonb:='[]';
  v_user uuid; v_trade uuid; v_slot integer; v_type text; v_size bigint;
begin
  select cursor into v_cursor from public.journal_screenshot_maintenance where name='legacy-backfill' for update;
  if exists(select 1 from public.journal_screenshot_maintenance where name='legacy-backfill' and completed_at is not null) then
    return jsonb_build_object('done',true,'added',0,'invalid','[]'::jsonb);
  end if;
  for o in select name,metadata,created_at from storage.objects where bucket_id='journal-screenshots' and name>v_cursor order by name limit v_limit loop
    v_count:=v_count+1; v_cursor:=o.name;
    if exists(select 1 from public.journal_trade_screenshots where object_path=o.name) then continue; end if;
    if o.name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[012]$' then
      v_invalid:=v_invalid||jsonb_build_array(o.name); continue;
    end if;
    v_user:=split_part(o.name,'/',1)::uuid; v_trade:=split_part(o.name,'/',2)::uuid; v_slot:=split_part(o.name,'/',3)::integer;
    v_type:=o.metadata->>'mimetype';
    v_size:=case when o.metadata->>'size' ~ '^[0-9]{1,10}$' then (o.metadata->>'size')::bigint else 0 end;
    if not pg_try_advisory_xact_lock(hashtextextended(v_user::text,731)) then
      -- Retry this whole page on contention; no cursor advancement loses images.
      raise exception 'JOURNAL_WRITE_BUSY' using errcode='55P03';
    end if;
    if v_type is null or v_type not in ('image/png','image/jpeg','image/webp') or v_size not between 1 and 3145728
      or not exists(select 1 from public.trades where id=v_trade and user_id=v_user)
      or not exists(select 1 from auth.users where id=v_user)
      or exists(select 1 from public.journal_access where user_id=v_user and deletion_requested_at is not null)
      or exists(select 1 from public.journal_trade_screenshots where user_id=v_user and trade_id=v_trade and slot=v_slot and state in ('uploading','ready')) then
      v_invalid:=v_invalid||jsonb_build_array(o.name); continue;
    end if;
    insert into public.journal_trade_screenshots(user_id,trade_id,slot,object_path,client_upload_id,content_hash,mime_type,byte_size,state,created_at)
      values(v_user,v_trade,v_slot,o.name,gen_random_uuid(),repeat('0',64),v_type,v_size::integer,'ready',coalesce(o.created_at,clock_timestamp()));
    v_added:=v_added+1;
  end loop;
  update public.journal_screenshot_maintenance set cursor=v_cursor,
    completed_at=case when v_count<v_limit then clock_timestamp() else null end where name='legacy-backfill';
  return jsonb_build_object('done',v_count<v_limit,'added',v_added,'invalid',v_invalid);
end $$;

revoke all on function public.queue_journal_screenshot_cleanup(uuid),public.check_journal_screenshot_upload_rate(uuid),
  public.reserve_journal_screenshot(uuid,uuid,uuid,text,text,integer,integer,integer),
  public.finalize_journal_screenshot(uuid,uuid,uuid,uuid),public.abort_journal_screenshot(uuid,uuid,uuid,uuid),
  public.delete_journal_screenshot(uuid,uuid,uuid),public.delete_trade_screenshot_cleanup(),public.delete_user_screenshot_cleanup(),
  public.claim_journal_screenshot_cleanup(integer),public.finish_journal_screenshot_cleanup(uuid,uuid,boolean),
  public.reconcile_journal_screenshots(integer),public.backfill_journal_screenshots(integer)
  from public,anon,authenticated;
grant execute on function public.check_journal_screenshot_upload_rate(uuid),public.reserve_journal_screenshot(uuid,uuid,uuid,text,text,integer,integer,integer),
  public.finalize_journal_screenshot(uuid,uuid,uuid,uuid),public.abort_journal_screenshot(uuid,uuid,uuid,uuid),
  public.delete_journal_screenshot(uuid,uuid,uuid),public.claim_journal_screenshot_cleanup(integer),
  public.finish_journal_screenshot_cleanup(uuid,uuid,boolean),public.reconcile_journal_screenshots(integer),public.backfill_journal_screenshots(integer)
  to service_role;
notify pgrst,'reload schema';
commit;
