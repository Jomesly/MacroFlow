-- Disposable local database only. All fixtures roll back.
-- The outcome table is server-only, rejects impossible values, and keeps one row per signal hour.
\set ON_ERROR_STOP on
begin;
do $$
declare v_rls boolean; v_count integer;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.signal_outcomes'::regclass;
  if not v_rls then raise exception 'signal_outcomes must have row level security enabled'; end if;

  begin
    insert into public.signal_outcomes (id, symbol, side, grade, forecast_version, bias_score, issued_at, checks)
      values ('GBPUSD:2026-11-23T08', 'GBPUSD', 'flat', 'A', 'test', 55, '2026-11-23T08:05:00Z', '[]');
    raise exception 'a flat side must be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.signal_outcomes (id, symbol, side, grade, forecast_version, bias_score, issued_at, checks, outcome)
      values ('GBPUSD:2026-11-23T07', 'GBPUSD', 'long', 'A', 'test', 55, '2026-11-23T07:05:00Z', '[]', 'pending');
    raise exception 'an unknown outcome must be rejected';
  exception when check_violation then null;
  end;

  insert into public.signal_outcomes (id, symbol, side, grade, forecast_version, bias_score, issued_at, checks)
    values ('GBPUSD:2026-11-23T09', 'GBPUSD', 'long', 'A', 'test', 55, '2026-11-23T09:05:00Z', '[]')
    on conflict (id) do nothing;
  insert into public.signal_outcomes (id, symbol, side, grade, forecast_version, bias_score, issued_at, checks)
    values ('GBPUSD:2026-11-23T09', 'GBPUSD', 'long', 'B', 'test', 40, '2026-11-23T09:35:00Z', '[]')
    on conflict (id) do nothing;
  select count(*) into v_count from public.signal_outcomes where id = 'GBPUSD:2026-11-23T09';
  if v_count <> 1 then raise exception 'expected one row per signal hour, found %', v_count; end if;
  if (select grade from public.signal_outcomes where id = 'GBPUSD:2026-11-23T09') <> 'A' then
    raise exception 'a duplicate run must not replace the first recorded signal';
  end if;
  if (select outcome from public.signal_outcomes where id = 'GBPUSD:2026-11-23T09') <> 'open' then
    raise exception 'a new signal must start open';
  end if;
end $$;
rollback;
