# Account management

Release integration branch: `release/account-management-20261112` (based on current production).

## Local evaluation

With Docker Desktop running, run `powershell -ExecutionPolicy Bypass -File scripts/start-account-eval.ps1` and visit `http://localhost:3001/login`.

Use **evaluator@macroflow.test** / **MacroFlow-Local-2026!**. These credentials belong only to the disposable local evaluation project. Its sample accounts/trades are synthetic. The script preserves existing evaluator data; if you delete the evaluator, restarting creates a fresh evaluator and samples.

This uses a separate, unlinked Supabase project under `%TEMP%/macroflow-account-eval` on ports 55421/55422/55424. It overrides credentials only in the script process and does not edit `.env.local` or change hosted data. Local mail is available on port 55424. Stop the app with Ctrl+C; stop its database services with `npx supabase stop --workdir "$env:TEMP/macroflow-account-eval"` when finished.

To evaluate the integrated release alongside an existing evaluation server, add `-ReleaseEvaluation`. This uses `%TEMP%/macroflow-account-release`, Supabase ports 55621/55622/55624, and app port 3002. Both modes install the production journal prerequisites and the account compatibility migration.

In **Journal → Accounts**, edit a display name/notes, pause/resume, remove while keeping history, or remove and erase its linked trades after typing the login. Removed accounts are listed in a collapsed section for explicit reconnection. Retained history remains filterable in Analytics. Reconnecting permits historical reimport if the EA still has those trades.

**Account settings** is outside the journal access boundary, so verified identity can delete an account even when journal permission has been revoked. Deletion requires the current password and typing `DELETE`. It freezes journal writes, revokes keys, then uses Supabase Auth hard deletion with application foreign-key cascades. If Auth deletion fails, data remains frozen; return to Account settings and retry. Successful deletion clears browser auth cookies and notifies other journal tabs.

Active legacy subscriber records with a Stripe customer ID block full deletion until billing is resolved. There is no billing-cancellation API in this repository. The block runs before freezing the account. Payment-provider records are outside this application's database.

## Deployment

Apply migrations before deploying this application, in this order:

Run `supabase/account-management-preflight.sql` in the target project's SQL Editor first. It is read-only: all prerequisite rows must pass, and its final result indicates whether to skip the original account migration. Confirm the project's backup before making changes. Run each migration's complete contents, including its transaction. Set a session `lock_timeout` (for example `set lock_timeout = '5s';`) before the original migration.

1. Existing prerequisites: `schema.sql`, `subscribers.sql`, `journal-autosync.sql`, `signup-login.sql`, `trading-accounts.sql`, `journal-account-funds.sql`, `journal-imports.sql`. These are already installed in the current production project; do not reinstall them over account guards.
2. Apply `supabase/account-management.sql` once if the account lifecycle feature has not been installed.
3. Apply `supabase/account-management-hardening.sql`. This forward migration is rerunnable and preserves account state, versions, and operation receipts.
4. Apply `supabase/account-management-journal-compat.sql`. This forward migration preserves the current production manual accounts, revision-aware trades, funds, and CSV imports while enforcing deletion locks. It also permits complete Auth cascades through journal audit records. It is required even when the original account migrations were already applied.
5. Verify `management_version` and the service-only RPCs, including `run_managed_journal_rpc`, exist before cutting over. Run `supabase/tests/account-management.sql` and `supabase/tests/account-management-journal-compat.sql` only on disposable staging data. Confirm browser roles lack execution privileges.

Use `supabase/account-management-verify.sql` for the read-only post-installation checks. Every row must pass. This checks columns, RPC grants, triggers (including newer journal tables), and Auth cascade relationships; it does not replace staging behavior tests.

**Never rerun the original `account-management.sql` after hardening.** It replaces hardened triggers/functions with their original versions. Track migration completion in the deployment system; the local startup script checks for the existing lifecycle schema before deciding whether the original migration is needed. Roll back application code only to a version compatible with these guards; keep the hardened database functions installed.

Inspect the hosted schema and back it up first. Rehearse on staging with representative table sizes and the deployed Auth settings. The original migration replaces owner foreign keys on trades/broker connections with cascade deletion and can require table scans/locks. Apply it in a controlled window with a session `lock_timeout` and verify the whole transaction commits. Hardening has a five-second lock timeout and rolls back on lock contention. Local synthetic timings do not establish hosted deployment duration. Nullable legacy ownership is preserved and never inferred.

Account management RPCs are executable only by `service_role`; browser roles cannot supply arbitrary owners. New application writes take the owner transaction lock before locking rows. Legacy/direct writers fail promptly with `JOURNAL_WRITE_BUSY` if they would invert that order. Database guards reject old imports into paused/removed accounts, so a deployment overlap cannot recreate a removed connection. Old unversioned account-management clients fail closed and must reload the new application. During overlap, older servers may return a temporary generic error for blocked writes; clients can retry after cutover. Do not remove the guards to make an old application version work.

Each management request includes the version shown when its dialog opened and an operation UUID. Matching immediate retries return the saved receipt; a changed request or stale version conflicts. Reconnection advances the version, so a delayed purge cannot erase the new history. Sync does not change the management version. Retained trades remain editable through the guarded trade RPC.

Full account deletion freezes inserts, updates, and deletes, revokes keys, then deletes the Auth identity and its owned records through foreign-key cascades. Pending deletion can be retried from Account settings. Trade/user deletions cannot be undone by rolling back code. Reconnection may reimport broker history. Active legacy billing still requires resolution with the site owner; no automatic provider cancellation is implemented.

## Verification

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.

See `docs/account-management-review-2026-11-12.md` for the earlier feature-branch evaluation and `docs/account-management-release-2026-11-12.md` for production integration verification. Run checks from the release worktree to avoid unrelated developer changes and generated review caches.

After starting the isolated evaluation server, set `$env:MACROFLOW_ACCOUNT_TEST_STATUS = "$env:TEMP/macroflow-account-eval/status.json"` and run `npx playwright test --config playwright.accounts.config.ts`. For `-ReleaseEvaluation`, use `$env:MACROFLOW_ACCOUNT_TEST_STATUS = "$env:TEMP/macroflow-account-release/status.json"` and `$env:MACROFLOW_ACCOUNT_TEST_BASE_URL = 'http://localhost:3002'`. Tests reject hosted Supabase URLs, create their own disposable identities and exercise real database/Auth/API/UI flows. SQL assertions are in `supabase/tests/account-management.sql` and `supabase/tests/account-management-journal-compat.sql`; run with `psql -v ON_ERROR_STOP=1` against a disposable database after applying all migrations. Fixtures roll back.

Run `node scripts/test-account-concurrency.mjs` against the fixed disposable account-eval container for deterministic two-connection locking regressions. It creates and cleans up its own synthetic identity.

For the integrated release evaluator, run `node scripts/test-account-concurrency.mjs --release-evaluation`. Existing funds/import browser regressions can use the release status file through `MACROFLOW_AUTH_TEST_STATUS` and the release app URL through `MACROFLOW_ACCOUNT_TEST_BASE_URL`.

Production currently has screenshots disabled. Before enabling screenshots, add Storage cleanup for full user deletion and broker-trade purge, including protection against concurrent uploads; database cascades alone do not remove uploaded files.

Run `node scripts/test-account-migration.mjs` to rehearse a fresh application install, upgrade over 20,000 synthetic trades, and a state-preserving hardening rerun in a temporary database inside the local evaluation container. It copies local platform schema only and drops its own temporary database afterward.
