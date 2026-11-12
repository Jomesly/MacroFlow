# Account management — pre-push review, 2026-11-12

Branch: `feature/account-management`. No commit, push, hosted migration, or deployment was performed.

## Decision

The three reproduced bugs from the November 11 review are fixed, with database and browser regression coverage. The feature is ready for local product evaluation. The checks below support code readiness; production release still requires the hosted preflight and controlled migration steps described below. This is not a claim that software can be guaranteed bug-free.

The application is running at **http://localhost:3001/login**, against an isolated local Supabase project. Demo login: **evaluator@macroflow.test** / **MacroFlow-Local-2026!**. All sample accounts/trades are synthetic. The startup script preserved the existing evaluator data.

## Fixed defects

| Finding | Fix and evidence |
| --- | --- |
| Deadlock between ordinary writes and account operations | Trade writes, profile saves, and API-key mutations now acquire the owner lock before row locks. Older direct writers use a nonblocking lock in the database guard and receive a retryable busy error instead of deadlocking. Actual overlapping PostgreSQL sessions verify both paths. |
| Older ingestion bypassed pause/removal | Database triggers reject old broker upserts and trade inserts/updates for inactive accounts. New RPC ingestion and old/direct writes both respect lifecycle state. Retained history can still be edited through the guarded journal RPC. |
| Stale purge deleted reconnected history | Account mutations carry an expected management version and operation UUID. Exact immediate retries return the saved outcome; changed payloads conflict. Reconnect advances the version, so replaying an old purge cannot delete new trades. SQL and browser tests reproduce and reject the original attack sequence. |
| Removal confirmation omitted the display name | Dialogs now show the captured name, login, server, and trade count. They retain the version shown when opened, even after background polling; a conflict requires a fresh confirmation. |
| Race in API-key creation limit | Key count and creation happen under the same owner lock. Five simultaneous creation requests produce exactly three keys. Revocation is owner-scoped and rechecked during authentication. |
| Incomplete deployment instructions | The runbook now requires the original account migration followed by hardening, verifies new RPCs before app cutover, and prohibits replaying the original migration afterward. |

Normal trade updates send only changed fields and validate combined state inside the locked database transaction, preserving concurrent sync values. Profile updates preserve the earliest onboarding completion timestamp. Full user deletion retains password verification, typed confirmation, deletion freeze, key revocation, retry support, and Auth cascades.

## Verification evidence

- **392 unit tests passed across 43 files**, including account inputs, account deletion failures, journal access, profile handling, ingestion, and the repository's existing tests.
- **9 browser integration tests passed** against real local Auth/PostgREST/PostgreSQL: editing; pause/resume; history retention and purge; reconnect; origin/ownership/session protections; concurrent sync/removal; full deletion with revoked access; pending deletion retry; billing block; mobile dialogs; stale dialog after polling; purge replay; concurrent key limits/revocation; profile saves; manual trade edits/deletion; retained-history editing.
- The additional profile/trade browser test initially expected `/journal` instead of the existing `/journal?tab=log` redirect. The assertion was corrected and that test passed on rerun; the other eight cases passed in the full run.
- **SQL regression assertions passed**, covering database ownership, lifecycle enforcement for older writes, request idempotency/conflicts, stale replay, key limits, profile updates, deletion freeze for insert/update/delete, Auth cascades, and service-role-only RPC grants.
- **Five deterministic database concurrency checks passed:** legacy write fails fast without deadlock; partial edit preserves concurrent sync prices; ordinary edit serializes with removal; key touch fails closed after deletion freeze; migration lock timeout aborts without replacing existing hardened functions.
- **Migration rehearsal passed** in a newly created disposable database using local platform schema and no user data copy. The original migration applied over 20,000 synthetic trades in 276 ms and hardening in 258 ms, including local Docker/psql startup. A hardening rerun preserved account state, management version, operation receipt, and all 20,000 trades. These are local measurements, not production timing estimates.
- **TypeScript and the production build passed** after the final application changes.
- **Source/configuration lint: zero errors, one preexisting unused-variable warning** in `src/lib/__tests__/engine.test.ts:122`. Generated caches and the separate `.claude/worktrees` checkout are excluded. The broader lint invocation scanned generated files in that other checkout and failed; those findings are not application-source failures. Targeted lint of the final changed files also passed.
- `git diff --check` passed. Unrelated forecast/news/dashboard changes remain untouched by this task.

## Full-plan assessment

| Planned behavior | Assessment |
| --- | --- |
| Dedicated Accounts UI with status and trade counts | Implemented and evaluated locally |
| Display-name/notes editing, preserved through sync | Verified |
| Pause/resume | Verified for both new and older write paths |
| Remove connection while keeping history | Verified; retained trades remain editable |
| Remove connection and linked imported trades | Verified with typed login; unrelated manual trades preserved |
| Prevent automatic recreation by the EA | Verified at the database boundary |
| Explicit reconnect and historical reimport warning | Verified; stale purge requests rejected |
| Shared keys and other trading accounts remain usable | Owner/account scoping verified; removal does not revoke shared keys |
| Full MacroFlow user deletion | Password/typed DELETE, write freeze, key revocation, and cascades verified |
| Deletion without active journal permission | Verified through the separate Account settings route |
| Partial deletion failure and retry | Unit failure-path coverage plus browser pending-deletion retry; no real hosted-provider outage injected |
| Active linked billing | Blocks deletion before freezing; automatic billing-provider cancellation is intentionally absent |
| Origin, ownership, session, and lifecycle conflicts | Verified |
| Mobile dialog, cancel, and Escape behavior | Verified at a 390px viewport and desktop |
| Migration/release compatibility | Local install, populated upgrade, rerun, lock timeout, and old-write guards verified; hosted checks remain |

## Independent reviews

### Standards

One release-process finding: the runbook omitted hardening and implied the original migration could still be rerun. Corrected in `docs/account-management.md`. No additional high-confidence runtime defect was found by that reviewer. This was a read-only review, not an independent rerun of the tests.

### Spec

One finding: the documented deployment sequence did not install the RPCs required by the new application. Corrected. The reviewer confirmed by inspection that the stale-dialog/version, lifecycle, lock-order, deletion-freeze, and display-name requirements are implemented. No further confirmed runtime safety defect was reported.

Both axes reported the same release-document gap. No reviewed finding remains unaddressed in the local implementation.

## Before production

1. Review the localhost flows and approve the intended deletion behavior.
2. Select the account-management changes for the eventual commit; this working tree also contains unrelated work. Do not stage the entire tree indiscriminately.
3. Inspect the hosted schema and Auth configuration, confirm the deployment migration ledger, and take a verified backup. Rehearse on staging with representative data volume and the production Auth settings. Those hosted conditions were not inspected or changed in this task.
4. Install `account-management.sql` only if the original feature migration is absent, then install `account-management-hardening.sql`. Never rerun the original migration after hardening. Verify `management_version` and all four new service-only RPCs before app cutover.
5. Apply the original foreign-key migration in a controlled window with a session lock timeout; it can scan/lock large hosted tables. Hardening has its own five-second lock timeout and rolls back on contention.
6. Deploy the compatible application, smoke-test using a disposable staging/test identity, then monitor ingestion errors, account conflicts, and pending deletions. Old unversioned management clients must reload. Older direct writers may receive temporary busy/lifecycle errors during overlap, while the database prevents unsafe writes.

Code rollback cannot restore deleted user/trade data. Retain database hardening when rolling back compatible application code. Active billing must be resolved separately; deleting MacroFlow data does not close the account at the broker or remove payment-provider records.

## Reproducible commands

```powershell
npm test
npx tsc --noEmit
npm run build
npm run lint -- --ignore-pattern '.artifacts/**' --ignore-pattern '.hallmark/**' --ignore-pattern '.playwright-mcp/**' --ignore-pattern '.superpowers/**' --ignore-pattern '.claude/worktrees/**'
powershell -ExecutionPolicy Bypass -File scripts/start-account-eval.ps1
$env:MACROFLOW_ACCOUNT_TEST_STATUS = Join-Path $env:TEMP 'macroflow-account-eval/status.json'
npx playwright test --config playwright.accounts.config.ts
node scripts/test-account-concurrency.mjs
node scripts/test-account-migration.mjs
```

Run SQL assertions in `supabase/tests/account-management.sql` with `psql -v ON_ERROR_STOP=1` only against a disposable database after both migrations. The fixture transaction rolls back. The concurrency and migration scripts are fixed to the local account-eval container and clean up their own synthetic fixtures/database.
