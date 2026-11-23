-- Deployment step only, after supabase/signal-outcomes.sql and after the app is deployed
-- with SIGNALS_CRON_SECRET set in Vercel (Production). The route enforces that Bearer secret.
-- Configure Vault names signals_run_url (https://<app host>/api/signals/run) and
-- signals_run_secret (the same value as SIGNALS_CRON_SECRET) through the project's secure
-- settings first; never commit their values.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='signals_run_url' and decrypted_secret like 'https://%/api/signals/run')
    or not exists(select 1 from vault.decrypted_secrets where name='signals_run_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configure signals run URL and secret in Vault before scheduling';
  end if;
end $$;
-- Five past every hour: the hourly bars the resolver needs have closed by then.
select cron.schedule('macroflow-signals','5 * * * *',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='signals_run_url'),
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='signals_run_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
$job$);
commit;
