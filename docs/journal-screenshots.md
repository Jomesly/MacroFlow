# Private clipboard screenshots

Implemented on `feature/journal-trade-images`. Screenshot intake is controlled by
`NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED`; enabling it requires the lifecycle
migration and a scheduled cleanup worker. Rebuild the application when changing
this public environment variable.

## Behavior

Open Journal > History > trade > Edit. Paste an image with Ctrl+V (Command+V on
macOS), or use Add image. The preview progresses from Preparing to Saving to
Saved. Screenshots save independently of trade fields; Cancel discards field
edits while keeping screenshots that already saved. The read view shows the
private image gallery. Open trades use their existing Close Trade editor.

Three images per trade, PNG/JPEG/WebP, at most 3 MiB stored per image. Browser
preparation accepts up to 20 MiB and 24 megapixels. Images over the stored limit
are compressed as WebP with quality no lower than 0.85; if necessary their long
edge is reduced to 4096 pixels. Images that still exceed the limit are rejected.
The server independently validates signatures, byte size, and complete pixel
decoding. Animated images are rejected. Images are never put into notes or
browser persistent storage.

Every authenticated upload attempt is limited before image decoding, including
retries and malformed submissions. The database permits 30 attempts per owner
per minute; retry identity and the three-image capacity are enforced separately.

Images attach only to the selected trade. Manual, CSV, and synced trades use the
same attachment flow. Pasting text into Notes still works normally. An upload
failure keeps its local preview for retry; the retry reuses its operation ID.
Expired/cancelled operations require an explicitly started new upload. Reloading
can recover a server-confirmed image even if its original HTTP response was lost.

## Local verification

Requires Node/npm, Docker Desktop, and the Supabase CLI (the setup uses npx).
From this worktree:

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/start-screenshot-eval.ps1
```

This starts the application at `http://localhost:3004` against the disposable
`macroflow-screenshot-eval` project, using API port 55721, database port 55722,
and mail port 55724. Real Supabase Storage runs locally. Existing account
evaluators and hosted Supabase are not used. `-SetupOnly` prepares the database;
`-AppOnly` reuses it. `-BaseOnly` is intended for migration tests.

In another terminal:

```powershell
npx playwright test --config tests/screenshots/playwright.config.ts
node scripts/test-screenshot-concurrency.mjs
npm test
npx tsc --noEmit
npm run lint
```

Browser/API tests create disposable local identities. Native Windows clipboard
tests use a screenshot of the rendered editor, put it on the OS clipboard, and
press Ctrl+V in Chromium and Edge. The helper preserves the original clipboard
in process memory and restores it only if it has not since been changed by the
user. Browser artifacts stay under `.artifacts/screenshot-eval`.

See [the dated verification record](../tests/screenshots/LOCAL-RESULTS.md) for
the completed checks and remaining browser/hosted-environment coverage limits.

Run SQL assertions inside the local container after copying current files:

```powershell
docker cp supabase/. supabase_db_macroflow-screenshot-eval:/tmp/macroflow-sql
docker exec supabase_db_macroflow-screenshot-eval psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/macroflow-sql/tests/journal-screenshot-lifecycle.sql
```

## Deployment order

1. Keep screenshot intake disabled. Apply `journal-screenshots.sql` and then
   `journal-screenshot-lifecycle.sql` after the existing account-management and
   production journal migrations. Do not rerun the original account-management
   migration over hardened code.
2. Inventory Storage and run `select public.backfill_journal_screenshots(100);`
   until the response says `done: true`. Retain and review every returned invalid
   path before running reconciliation. Valid legacy `<user>/<trade>/<slot>`
   images are registered without moving their bytes. The persisted cursor makes
   rerunning safe. New images use immutable UUID paths.
3. Deploy `supabase/functions/screenshot-cleanup` with
   `supabase functions deploy screenshot-cleanup --no-verify-jwt` for the intended
   project. Configure a random `SCREENSHOT_CLEANUP_SECRET` of at least 32
   characters in Edge Function secrets. This is a dedicated worker credential,
   not a public key or an end-user session. The handler requires an exact Bearer
   secret and POST, even with gateway JWT verification disabled.
4. Configure Vault secrets `screenshot_cleanup_url` (the deployed function URL)
   and `screenshot_cleanup_secret` (the same dedicated secret). Apply
   `journal-screenshot-schedule.sql` to run the worker each minute. Keep this
   schedule active even when screenshot intake is disabled.
5. Verify an authorized worker call succeeds and an unauthorized one fails.
   Verify real object removal, retries, and migration reruns in preview. Ensure
   the hosting platform permits a 3 MiB multipart body plus 64 KiB overhead and
   the bounded Storage request fits its function duration.
6. Enable `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED=true`, rebuild/deploy, and smoke
   test a disposable account's paste, reload, full-image view, removal, and
   cleanup. A failed rollout can disable intake again while leaving lifecycle
   protection and cleanup running.

The deployment/scheduling steps change external state and are separate from
local implementation and testing. This branch has not applied hosted migrations
or enabled the production feature.

## Storage lifecycle

Reservation and finalization run under the journal's existing per-owner lock.
The database allocates the three slots atomically and grants exactly one upload
writer per operation. Storage receives an immutable path without overwrite.
The server's 30-second Storage deadline fits inside a 90-second upload lease.
Failed or incomplete uploads keep a recoverable reservation. Finalization after
expiry/deletion is rejected and cleanup is durably recorded.

Deleting a trade, purging an account, undoing an imported trade, or deleting a
user records exact cleanup paths in the same transaction that removes access.
Pending account deletion also blocks finalization. Retaining account trades
keeps their images. Cleanup records have no cascading parent foreign keys, so
Auth deletion cannot erase the only record of stored bytes.

The worker claims at most eight jobs per invocation and runs at most four
Storage removals concurrently. Each Storage request has a 20-second deadline.
Claims expire after two minutes. Failed jobs retry with capped exponential
backoff. A stale worker cannot complete another worker's claim. Uploading images
wait until their upload lease plus 60 seconds before removal is claimable.

Reconciliation expires incomplete reservations and scans Storage metadata in
bounded pages after legacy backfill completes. Unreferenced objects older than
ten minutes are queued; a late object recreating a completed cleanup path
reopens that job. The worker only deletes through the Storage API, never SQL
deletion of `storage.objects`. New uploads never reuse a deleted object path.

## Monitoring and limits

The worker returns counts (`claimed`, `removed`, `failed`, `stale`, `expired`,
`orphans`) without image contents or provider error details. Inspect function
invocations and `cron.job_run_details` for failures; also check HTTP responses
recorded by pg_net. A cron SQL success alone is not proof of HTTP worker success.

```sql
select count(*) as pending,
  min(available_at) as oldest_available_at,
  max(attempts) as highest_attempt_count
from public.journal_screenshot_cleanup where completed_at is null;

select count(*) as expired_uploads
from public.journal_trade_screenshots
where state='uploading' and upload_expires_at < now();
```

Alert on sustained cleanup failures, growing queue age, stale uploads, and
unexplained bucket growth. The normal cleanup target is five minutes for a small
queue; bulk purges can take longer at eight objects per scheduled invocation.
Tune schedule frequency/batching only with the claim deadline and Storage rate
limits in mind. Tombstones are retained for retry identity and recovery; a later
retention policy must preserve late-upload recovery and immutable path safety.

References: [Supabase Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects),
[scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions),
[MDN paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event).
