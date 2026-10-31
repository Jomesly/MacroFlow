-- LOCAL / DISPOSABLE TEST DATABASE ONLY. Requires the three existing schema files.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001', 'legacy-active@example.test'),
 ('00000000-0000-0000-0000-000000000002', 'legacy-denied@example.test'),
 ('00000000-0000-0000-0000-000000000003', 'pending@example.test');
insert into public.subscribers (id,email,status) values
 ('00000000-0000-0000-0000-000000000001','legacy-active@example.test','active'),
 ('00000000-0000-0000-0000-000000000002','legacy-denied@example.test','cancelled');

\ir ../signup-login.sql

do $$ begin
  assert (select status = 'active' and source = 'legacy' from public.journal_access where user_id = '00000000-0000-0000-0000-000000000001'), 'legacy active backfill';
  assert (select status = 'revoked' and source = 'legacy' from public.journal_access where user_id = '00000000-0000-0000-0000-000000000002'), 'legacy denial preserved';
  assert (select status = 'active' and source = 'beta' from public.journal_access where user_id = '00000000-0000-0000-0000-000000000003'), 'pending beta grant';
end $$;

update public.profiles set display_name = 'Saved name', reporting_timezone = 'Asia/Manila' where id = '00000000-0000-0000-0000-000000000001';
update public.journal_access set status = 'revoked' where user_id = '00000000-0000-0000-0000-000000000001';
\ir ../signup-login.sql

begin;
do $$ begin
  assert (select status = 'revoked' from public.journal_access where user_id = '00000000-0000-0000-0000-000000000001'), 'rerun restored access';
  assert (select display_name = 'Saved name' and reporting_timezone = 'Asia/Manila' from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'rerun overwrote preferences';
  assert (select status = 'active' from public.subscribers where id = '00000000-0000-0000-0000-000000000001'), 'subscriber changed';
  assert not has_table_privilege('authenticated','public.journal_access','UPDATE'), 'client can change access';
  assert not has_table_privilege('anon','public.profiles','SELECT'), 'anonymous can read profiles';
  assert (select relrowsecurity from pg_class where oid = 'public.journal_access'::regclass), 'access RLS disabled';
  assert not has_function_privilege('authenticated','public.provision_journal_user()','EXECUTE'), 'client can invoke provisioner';
end $$;

insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000004','new@example.test','{"status":"paid","source":"legacy"}');
do $$ begin
  assert (select source = 'beta' and status = 'active' from public.journal_access where user_id = '00000000-0000-0000-0000-000000000004'), 'metadata changed grant';
  assert (select reporting_timezone = 'UTC' from public.profiles where id = '00000000-0000-0000-0000-000000000004'), 'profile not provisioned';
end $$;

-- Simulate a provision failure and prove the Auth INSERT is atomic.
create function pg_temp.fail_profile() returns trigger language plpgsql as $$ begin raise exception 'test provision failure'; end $$;
create trigger test_profile_failure before insert on public.profiles for each row execute function pg_temp.fail_profile();
do $$ begin
  begin
    insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000005','failure@example.test');
    raise exception 'expected trigger failure';
  exception when raise_exception then
    assert not exists(select 1 from auth.users where id = '00000000-0000-0000-0000-000000000005'), 'failed provision left an Auth user';
  end;
end $$;
rollback;
select 'signup/login migration assertions passed' as result;
