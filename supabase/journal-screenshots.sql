-- Private screenshots. Apply to a preview project first; never make this bucket public.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-screenshots', 'journal-screenshots', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive policy also blocks this bucket if another bucket has a broad
-- permissive policy. The server's service role bypasses RLS after ownership checks.
drop policy if exists journal_screenshots_server_only on storage.objects;
create policy journal_screenshots_server_only on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'journal-screenshots')
  with check (bucket_id <> 'journal-screenshots');
commit;

-- There are deliberately no permissive browser insert/select policies. The server checks
-- journal access + trade ownership on every request, and streams images without
-- public URLs or cached signed links. Service-role credentials stay server-side.
