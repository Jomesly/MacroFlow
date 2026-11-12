> Follow-up: the reproduced defects below were fixed and re-evaluated on November 12. See [the current pre-push report](account-management-review-2026-11-12.md). This file preserves the original findings.

# Account-management review — 2026-11-11

**Recommendation: hold production deployment.** The main flows work, but three reproducible bugs and one small plan omission remain. Fix the three bugs before release; the missing display name should be corrected alongside them.

Reviewed the uncommitted account-management changes on `feature/account-management`, relative to `HEAD` (`fd2fc0e`). The specification is the approved implementation plan in this conversation. Unrelated existing research documents, generated artifacts, and working changes were excluded from the feature review. Two independent review passes covered code correctness and specification coverage; their findings are kept separate below.

No application code, migration, or implementation test was changed during this review. Reproductions used dedicated fixtures in the isolated local Supabase evaluation database; fixtures were rolled back or removed. Hosted data and deployment settings were not touched.

## Standards

No repository-specific `AGENTS.md`, `CONTRIBUTING.md`, or `CODING_STANDARDS.md` was found. The substantive code-quality findings are:

### S1 — High: concurrent updates can deadlock

Location: `supabase/account-management.sql:44`, `:74`, `:115`, `:168`; ordinary writes also occur at `src/lib/ingest-store.ts:34` and in the journal trade-update path.

The row-level UPDATE guard takes the owner advisory lock after PostgreSQL has locked the updated row. Lifecycle and ingestion functions take the advisory lock first and then update rows. Two requests can therefore wait on each other in opposite order.

**Confirmed locally with two database connections:**

1. Connection A takes the owner advisory lock.
2. Connection B updates a trade, acquires its row lock, and waits for the advisory lock inside the trigger.
3. Connection A updates that same trade and waits for B's row lock.
4. PostgreSQL reports `ERROR: deadlock detected` and aborts A's transaction.

This can fail a sync, removal, or full-deletion preparation when it overlaps a normal trade edit or API-key usage update. PostgreSQL aborts a transaction rather than silently committing corrupted data, but the action fails for the user.

**Proposed correction:** acquire owner locks before row locks consistently across every participating write path. Review the trigger strategy and use guarded transaction functions where necessary. Add deterministic mixed-write concurrency tests; the current sync-versus-removal test has two advisory-lock-first operations and does not expose this problem.

### S2 — Medium: old ingestion bypasses lifecycle protection

Location: `supabase/account-management.sql:121`; `src/lib/ingest-store.ts:64`, `:94`, `:113`.

Paused/removed state is enforced by the new ingestion function. The generic database guard checks full-user deletion only. The prior application's direct account/trade upserts can therefore write into a paused or removed connection.

**Confirmed locally:** after removing and purging an account, replaying the old application's account upsert and trade insert left the account marked `removed` but inserted one trade successfully.

Exposure requires old code to run, for example an old in-flight request or overlapping old/new deployment instances. The current new ingestion endpoint correctly rejects the removed account. Documentation forbids rollback to the old ingester, but that alone does not prevent deployment overlap.

**Proposed correction:** enforce the lifecycle rule at the database write boundary, while preserving legitimate edits to retained history. Alternatively, define and verify a drain/cutover that ends old ingestion before exposing account removal. Database enforcement provides the stronger long-term protection.

## Spec

### P1 — High: removal protection is incomplete during deployment overlap

Plan requirement: “EA must not recreate removed account” and “atomic sync/removal.”

The old-ingestion bypass described in S2 violates the intended removal behavior when old requests overlap release. Runtime reproduction confirmed that a removed account can regain imported trades through that old path. The release process must prevent that overlap or the database must reject it.

### P2 — Medium: an old purge request can erase newly reconnected history

Plan requirement: “Repeated deletion requests are safe.”

Location: `supabase/account-management.sql:78`; `src/lib/account-management.ts:24`; `src/app/api/journal/accounts/[id]/route.ts:24`.

Removal accepts an account ID, a trade-deletion choice, and the login confirmation. It has no lifecycle revision or operation identity. Reconnecting reuses the same ID and login.

**Confirmed locally:**

1. Remove an account and delete its trades.
2. Reconnect it and import a trade: trade count becomes **1**.
3. Replay the original purge request: trade count becomes **0**.

An old dialog in another tab, or a retry after an ambiguous network response, can therefore delete history imported after reconnection. The request belongs to the same user, so ownership/session checks do not prevent it.

**Proposed correction:** bind destructive operations to a lifecycle revision and an operation identity checked inside the transaction. Replayed operations should return their original outcome or a conflict. A stale request must not apply to a new lifecycle revision. Do not use the existing `updated_at` field for this purpose because normal sync changes it continuously.

### P3 — Medium: mixed-write concurrency is not covered

Plan requirement: “Coordinate removal and ingestion in database transactions.”

The lock-order defect in S1 is confirmed. The existing browser test races ingestion against removal, but does not race ordinary trade updates or API-key usage updates against these lifecycle operations. Expand coverage to include those write paths and full-deletion preparation.

### P4 — Low: the removal dialog omits the display name

Plan requirement: confirmation shows “account name, login, server, and affected trade count.”

Location: `src/components/TradingAccountCard.tsx:80`.

The dialog shows login, server, and affected trade count, but omits the edited account name. Include the name when available so the user can identify the account consistently with its card.

No material scope additions were identified.

## Full-plan coverage

| Planned area | Assessment |
| --- | --- |
| Accounts tab and account cards | Implemented: name, identity, status, last sync, count, and actions |
| Edit display name and notes | Implemented; length validation and preservation through sync verified |
| Pause/resume | Implemented for the new ingestion path; old-code overlap remains a gap |
| Remove while retaining history | Implemented; retained history remains available and filterable |
| Remove and erase account trades | Implemented; typed confirmation and preservation of unrelated manual trades verified |
| Prevent EA recreation/import | Implemented in the new endpoint; database/old-code bypass remains |
| Explicit reconnect and reimport warning | Implemented; stale deletion requests remain unsafe after reconnect |
| Shared API keys | Implemented; removing an account does not revoke the user's other connections |
| Full MacroFlow deletion | Implemented: password verification, typed DELETE, freeze, key revocation, Auth deletion, and cascades |
| Deletion with revoked journal access | Implemented and tested through the separate Account settings route |
| Partial deletion failure | Retry behavior covered by unit tests and a browser test of prepared/pending deletion; a real provider outage was not injected |
| Active linked billing | Deletion is blocked before freezing; automatic subscription cancellation is not implemented |
| Origin, owner, and stale-user guards | Implemented and tested; they do not replace lifecycle-version checks |
| Dialog/mobile behavior | Tested for Escape/cancel and a 390px viewport; display-name omission remains |
| Deployment and migration | Files and instructions exist; old-request overlap and production migration rehearsal remain unresolved |

## Verification performed in this review

- **289 unit tests passed.**
- **Six browser integration tests passed**, covering editing, pause/resume, both removal choices, reconnection, ownership/origin checks, current sync-versus-removal concurrency, password verification, revoked-access deletion, pending-deletion retry, billing protection, and mobile dialogs.
- **SQL assertion suite passed.**
- **TypeScript and the production build passed.**
- **Lint passed with zero errors and one preexisting unused-variable warning**, excluding older generated review artifacts. Plain repository lint scans those artifacts and is not clean.
- Three additional adversarial reproductions exposed S1/P3, S2/P1, and P2. These cases are not in the implementation's regression suite yet.

Passing the existing suite does not resolve these reproduced failures.

## Proposed work before production

1. Fix lock ordering across ingestion, normal updates, and deletion preparation.
2. Add lifecycle revision/operation protection for destructive retries and reconnection.
3. Close the old-ingestion bypass or verify a drain/cutover before enabling removal.
4. Include the account display name in removal confirmation.
5. Add regression tests for the reproduced failures and rerun the suite.
6. Rehearse the migration and release against a representative staging database, including the existing owner foreign keys, table size/lock duration, and hosted Auth configuration. These hosted conditions were not verified by this local review.

The migration recreates foreign keys inside a transaction and needs a production-size lock-duration check. The migration being rerunnable and passing against small local fixtures does not establish deployment impact on the hosted database.

**Review totals:** Standards: two findings, worst S1 (deadlock). Spec: four findings, worst P1 (old-ingestion bypass during deployment overlap). There are three distinct reproduced bugs plus one small UI requirement omission across the two axes. The feature should remain in local evaluation until the fixes are reviewed and verified.
