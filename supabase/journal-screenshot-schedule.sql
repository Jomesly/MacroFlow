-- Deployment step only, after the worker is deployed with JWT gateway checking
-- disabled (the handler enforces its own dedicated Bearer secret).
-- Configure Vault names screenshot_cleanup_url and screenshot_cleanup_secret
-- through the project's secure settings first; never commit their values.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='screenshot_cleanup_url' and decrypted_secret like 'https://%/functions/v1/screenshot-cleanup')
    or not exists(select 1 from vault.decrypted_secrets where name='screenshot_cleanup_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configure screenshot cleanup URL and secret in Vault before scheduling';
  end if;
end $$;
select cron.schedule('journal-screenshot-cleanup','* * * * *',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='screenshot_cleanup_url'),
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='screenshot_cleanup_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=90000
  );
$job$);
commit;
