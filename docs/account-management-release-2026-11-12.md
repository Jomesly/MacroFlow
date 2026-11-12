# Account management production integration

This release integrates account management onto production commit `e824af15d452c41eb1596a4dccdad0d5ef96b2cd`. The original evaluation branch predates production's manual journal accounts, exact money, funds, revision-aware edits, and CSV import workflows. The release preserves those production features and adds an owner-locking dispatcher for their writes.

## Required hosted database step

The original account lifecycle and hardening migrations are present in the hosted database. The additional `supabase/account-management-journal-compat.sql` was absent during release preparation; the operator subsequently reported successful installation. Hosted REST checks now confirm the dispatcher is installed and executable by the server role, with anonymous execution denied. The server probe uses an unsupported operation and a nonexistent owner, so no application rows are changed. The **49 PASS rows** were observed locally; the hosted SQL Editor verification results were not independently observed. Do not rerun the original account migration over the hardened schema.

The additional migration integrates current journal mutations with account-deletion locks, freezes newer journal tables during pending deletion, and prevents Auth deletion from recreating trade-audit rows referencing a removed identity. It is forward-only and rerunnable. Apply the complete transaction; its five-second lock timeout rolls it back on contention. No hosted user data was used for destructive testing, and no hosted DDL was executed during local verification.

## Verification

- Unit suite: **701 tests passed across 59 files**.
- Production build: passed, including TypeScript and route generation.
- TypeScript standalone check: passed.
- ESLint: passed with zero errors and zero warnings.
- Account browser suite: **9 tests passed**, exercising edit, pause/resume, retain/purge, reconnect, stale confirmations, retries, concurrent sync/removal, ownership/origin checks, full deletion, revoked access, deletion retry, legacy billing block, mobile dialogs, key limits, profile and trade writes.
- Existing funds and CSV import browser suites: **6 tests passed**, including desktop/mobile accessibility, exact money, concurrent saves, duplicate imports, atomic commits, stale snapshots, and undo.
- Migration rehearsal: fresh production prerequisites, upgrade over **20,000 synthetic trades**, hardening and compatibility reruns preserving data/state/receipts, and both SQL regression suites passed. Observed base migration 279 ms and hardening 245 ms include local Docker/psql startup and do not predict hosted execution time.
- SQL compatibility assertions include revision conflicts, manual trade destination, funds, batches, CSV stage/commit/undo, retained broker-history edits, write freeze, role grants, and Auth cascades with a committed CSV trade still present.
- Read-only post-installation SQL: **49 PASS rows** locally.
- Deterministic two-connection checks: legacy writes fail fast without deadlock, queued edits preserve sync prices, retained history remains editable, the production dispatcher locks before rows, deletion freezes reject queued writes, and migration lock timeout preserves installed functions.

The release evaluator runs at `http://localhost:3002` with an isolated local Supabase project on ports 55621/55622/55624. Start it with `powershell -ExecutionPolicy Bypass -File scripts/start-account-eval.ps1 -ReleaseEvaluation`. Hosted credentials and the original evaluator are preserved. Browser fixtures use disposable local identities only.

## Review outcomes and limits

Spec review found deployment documentation and local evaluation gaps; both were corrected. The previously untracked account browser suite is now included. The committed-import cascade coverage gap was added and passes.

Standards review found a latent screenshot-storage cleanup gap. Production's `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED` flag is absent, so screenshots are disabled in this release's target configuration. **Before enabling screenshots**, implement deletion/purge cleanup and close the concurrent-upload race. Database cascades do not delete Storage objects. Recheck this production flag before cutover.

Active legacy billing blocks full deletion before journal freeze; the repository has no billing-provider cancellation API. Pending Auth deletion remains frozen and retryable. Destructive deletion cannot be undone by reverting application code. Keep the hardened database migrations when rolling application code back.

## Release status

Prepared and verified on `release/account-management-20261112`. Hosted compatibility installation is confirmed; the release is ready for production push to `main` and deployment verification. The original workspace's unrelated dashboard/forecast changes were preserved.
