> Historical journal/main readiness review preserved from `0e5de53`. See [the integration report](production-merge-2026-11-10.md) for the merged release.

# Production readiness — 10 November 2026

**Updated verdict: local release validation passes; the missing-schema blocker is resolved.** After the user applied the three migrations, a read-only recheck confirmed the required tables and columns are available in the configured hosted Supabase project. Production environment values and a hosted preview smoke test remain unverified. No deployment, Git push, or hosted database write was performed by the agent.

## Release scope

Audited the uncommitted working tree on `journal-ui-functionaly`, based on `b1fa916`: broker accounts, multi-account trade entry, funds and corrections, CSV/Notion imports and undo, analytics, expanded dashboard instruments, and direct market-analysis navigation. Commit all intended new files, including SQL migrations; `git diff` alone does not include untracked files.

## Database migration status

The initial read-only audit of `.env.local` Supabase (`soirhqcxyfaloowadoph.supabase.co`) found the missing schema below. **A subsequent recheck after the user ran the migrations confirms all these tables and columns are now available.**

- Existing profiles and journal-access tables are available.
- The new journal accounts, trade groups, funds, cash entries, trade revisions, import batches/rows, and setup-tag tables are absent (`PGRST205`).
- `trades.journal_account_id` is absent (`42703`).
- There are zero trades and broker-account records with a null owner. This is only one migration precondition, not a complete backfill guarantee.

The Vercel production project's environment-variable **names** were verified without decrypting values. This does not prove that its database is the same as `.env.local`. Confirm the actual target before applying SQL. A push alone does not apply these migrations.

## Fixes made during this audit

- Analytics now treats imported tag names such as `__proto__` and `constructor` as ordinary keys, without inherited-object collisions.
- Monetary analytics uses the account currency's precision; crypto results down to eight decimal places survive totals, buckets, and equity calculations. The dashboard identifies the currency and preserves small values in formatting.
- Analytics ignores responses from superseded filter requests.
- Modern trade rows use the transactional revision-checked update even when an older client omits `expectedRevision`.
- Drawdown is labeled as daily-close drawdown, with the missing-close-date fallback explained.
- Removed unused code and excluded generated local assistant/build artifacts from ESLint.
- Login accessibility checks wait for the entrance animation, matching the existing signup check. The initial contrast failures were transient animation states; no contrast exemption was added.
- Corrected the stale account documentation that described imports as unimplemented.

## Verification evidence

Recheck after the user's hosted migrations: production build and lint passed; all 290 unit tests, 7 production-mode journal tests, and 28 production-mode market/UI tests passed again. The auth-only rerun passed 8 tests with 2 CAPTCHA tests skipped; the five-minute expiry test was excluded from this rerun and retains its earlier passing result. Hosted database verification was read-only and confirmed schema availability, not authenticated write behavior. No hosted deployment preview was created or tested in this recheck.

| Check | Result |
| --- | --- |
| `npm test` | 290 tests passed across 30 files |
| `npm run lint` | Passed |
| Production Next.js build, Node 24.21.0 | Passed, including TypeScript |
| Full local auth/journal Playwright suite | 16 passed; 2 CAPTCHA tests skipped without a test site key |
| Final production-mode funds/import/dashboard suite | 7 passed, including new crypto-precision and legacy-edit revision assertions |
| Final production-mode market/UI suite | 28 passed |
| Fresh SQL migration rehearsal | Passed, including auth/backfill assertions and repeated account/funds/import migrations |
| Existing production `/login` HTTP smoke | HTTP 200, expected login heading |

The complete auth suite includes user isolation, confirmation/recovery, logout, concurrent refresh beyond the original five-minute token lifetime, MT5 ingestion, and private screenshots. Journal tests cover concurrent writes, duplicate prevention, cross-owner rejection, capital snapshots, import corrections, rollback on rejected transactions, and undo retaining edited trades. Browser checks cover responsive layouts, keyboard use, and automated accessibility.

The final production build and browser tests use disposable local Supabase, not hosted customer data. Public market tests use controlled feed fixtures; they do not certify live provider freshness or production quotas. No CI run, external vulnerability scan, or hosted authenticated smoke test is claimed.

The fresh migration rehearsal used a separate database in the disposable local Supabase container; it did not reset the developer's preview database. Local logs and scripts are in ignored `.artifacts/`.

## Required release sequence

1. Confirm Vercel Production's Supabase project, Node 24.x, public/server Supabase URL agreement, and production `NEXT_PUBLIC_APP_URL`. Verify Supabase auth redirect URLs and production email delivery. Do not copy the local test configuration.
2. Capture a restorable database backup and record the currently deployed application version. Rehearse restoring it in an isolated project before the release. No hosted backup/restore was tested during this audit.
3. Apply the existing schema/auth/autosync prerequisites if absent. Then apply, in order:
   - `supabase/trading-accounts.sql`
   - `supabase/journal-account-funds.sql`
   - `supabase/journal-imports.sql`
4. Run the migrations first in a staging copy of the target database. Check owner mappings, broker identities, row counts, balances, RLS/grants, and import functions. The clean local rehearsal does not replace checking real legacy data. Do not run SQL test fixtures against production.
5. After a successful target migration, deploy a preview from the exact release commit. Test sign-in, account selection, a win/loss and balance update, two-account logging, a small CSV import, undo, and market navigation with a designated test user. Verify no journal requests return schema errors.
6. Promote only after the above pass. Monitor journal errors, auth failures, ingestion failures, and funds/import requests immediately after release.

## Rollback and feature limits

- Preserve the additive schema on an application rollback; do not drop account/funds/import tables or audit history to restore the old UI.
- Before accepting new account/import writes, verify the previous version against the migrated schema. After accepting those writes, the old version is **not a proven safe rollback**: imported prices may be null and old screens may combine multiple accounts. Prefer a forward fix; if necessary restrict journal access using the existing access controls while recovering. Do not restore an old database over new trades without reconciling those writes.
- Keep screenshots disabled for this release. The production environment inventory has no screenshot-enable flag. Import undo currently treats revision 1 as untouched; attaching a screenshot does not revise the trade, so undo can remove the parent trade and leave an inaccessible storage object. Fix and test this interaction before enabling screenshots with imports.
- CAPTCHA-enabled flows were not exercised because no local test site key was supplied. If CAPTCHA is enabled in the target environment, its two skipped checks must pass before release.
- New S&P 500 and FX instruments are available on the market dashboard. Journal/import trade symbols remain the existing five; do not advertise the expanded dashboard list as new journal symbol support.
- Economic-calendar feeds remain US/UK-focused. New currency markets do not gain complete domestic-calendar coverage from this change.
- Funds accounting uses exact decimal values. Analytics uses JavaScript numbers for visualization and is not a replacement for the exact ledger at very large magnitudes.

**Go criteria:** target database migrations applied and verified, exact release preview passes its hosted smoke test, production configuration confirmed, and a recovery route rehearsed. The missing-schema requirement is now satisfied for the configured project; production environment verification and a hosted preview smoke test remain outstanding.
