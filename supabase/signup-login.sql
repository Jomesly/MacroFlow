-- Additive signup/login migration. Apply after schema.sql, subscribers.sql and
-- journal-autosync.sql. Inspect existing tables before applying to a hosted DB.
-- Never assigns owners to legacy trades or modifies subscriber records.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  reporting_timezone text not null default 'UTC',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.journal_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null default 'beta' check (source in ('beta', 'legacy')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.journal_access enable row level security;
-- No browser policies: all operations go through guarded server code.
revoke all on public.profiles, public.journal_access from anon, authenticated;
grant all on public.profiles, public.journal_access to service_role;

create or replace function public.provision_journal_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.journal_access (user_id, source, status)
    values (new.id, 'beta', 'active') on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.provision_journal_user() from public, anon, authenticated;

drop trigger if exists provision_macroflow_journal_user on auth.users;
create trigger provision_macroflow_journal_user
  after insert on auth.users
  for each row execute function public.provision_journal_user();

insert into public.profiles (id)
select id from auth.users on conflict (id) do nothing;

insert into public.journal_access (user_id, source, status)
select u.id,
  case when s.id is null then 'beta' else 'legacy' end,
  case when s.id is null or s.status = 'active' then 'active' else 'revoked' end
from auth.users u
left join public.subscribers s on s.id = u.id
on conflict (user_id) do nothing;

commit;
