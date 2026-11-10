# Production readiness — macro dashboard and calendar

**Decision: the reviewed dashboard/calendar changes are ready for review and commit. No unresolved C1–C7 software blockers were found after the repairs and checks below.** This is a local production-build assessment, not a deployment certification or evidence of a profitable trading model.

Verified on 2026-11-10 on `feature/dashboard`, based on HEAD `5137e8d48842b14bbc819f239ab1d3ddcd23d591` plus the current uncommitted changes. This supersedes the earlier [commit-readiness review](commit-readiness-2026-11-10.md) and [pre-production review](pre-production-review-2026-11-10.md). No staging, commit, push, or deployment was performed.

## Repairs

| Finding | Resolution |
|---|---|
| C1: revised feed forecast changes the surprise | Scoring uses the frozen first numeric consensus from the archive. Feed revisions/removal cannot replace it; null forecasts do not create earlier evidence. |
| C2: request-start time backdates late evidence | Inserts omit `first_seen_at`; the database timestamps receipt. Forecasts must precede release strictly. Legacy rows are preserved but excluded through the `consensus-v2:` namespace. |
| C3: failed refresh looks current | Saved events remain visible with a refresh-failed warning, last-success date/time and time zone, and Retry. Initial failure, malformed responses, and stalled requests recover through Retry. Requests time out after 20 seconds. |
| C4: filters fail with blocked browser storage | Filter state updates in memory before optional persistence. Currency, impact, and date controls remain usable when storage reads/writes throw. Normal persistence is preserved. |
| C5: archive failures look like no eligible events | The archive returns explicit health. `/api/calendar` exposes `archiveStatus`; `/api/bias` exposes `calendar_archive` and marks economic-calendar scoring failed when its archive is unavailable. Calendar events remain visible with an archive warning. Private database errors are not returned. |
| C6: duplicate database work | Concurrent archive requests for identical content share work within a process. Successful results are reused for 60 seconds in bounded local memory and optional Redis; failed results are retried rather than cached. The bias route reuses ingestion's next event instead of fetching the calendar again. |
| C7: stale documentation | The implementation guide now describes model v3.2 and the ForexFactory/FRED archive path. Earlier reviews are marked historical and point to this report. README includes the calendar test command and SQL requirements. |

The previously repaired regime-boundary, regional-Fed classification, future-bar replay, provenance, Redis-expiry, and shared-threshold defects remain covered by the passing source suite. Absolute bias >=50 continues to apply symmetrically to bullish and bearish dashboard ordering.

## Verification

| Check | Result |
|---|---|
| `npm test` | **264 passed / 36 files** |
| `npx tsc --noEmit` | Passed |
| `npx eslint src scripts tests/e2e/calendar.spec.ts vitest.config.ts` | Passed with 0 errors; one pre-existing unused-variable warning in `engine.test.ts:122` |
| `npm run build` | Passed, including `/api/calendar`, `/api/bias`, and TypeScript |
| Calendar browser suite against the production build | **6 passed** |
| `git diff --check` | Passed; existing line-ending conversion notices only |
| Live local `/api/calendar` using configured upstream services | HTTP 200; **105 events**; `archiveStatus: ok`; ForexFactory source |
| Live local `/api/bias` | HTTP 200; **5 assets**; model `macro-v3.2-4h-2026-11-10`; news/market/RSS/FRED/archive healthy; calendar surprises empty; next high event Core CPI m/m |
| Read-only Supabase v2-archive check after natural API ingestion | **45 rows**, no null forecasts or malformed timestamps; 31 recorded before scheduled release |
| Existing backtest artifact provenance | Replay/evaluation model and hash match; no changed price inputs; 8,335 rows in each; report contains current model/evaluation hash |

The two principal UI regressions were first run against the previous build: blocked-storage controls did not update, and failed refreshes had no stale warning. They pass against the repaired production build. The final browser suite covers blocked storage, stale-data/retry recovery, archive outage/retry recovery, normal persistence, desktop/mobile page overflow, initial failure, malformed refresh responses, and request timeout/retry. Normal browser checks recorded no runtime errors.

The collaborative browser snapshot timed out twice with `Preview automation snapshot timed out after 15000ms.` Browser verification used the repository's Playwright setup as the fallback. API fixtures isolate the UI cases from provider availability; separate live endpoint and archive checks establish actual connectivity. No synthetic records, schema changes, or destructive operations were performed against the connected database. Ordinary live API requests populated the repaired archive.

## Reproduce

```powershell
npm test
npx tsc --noEmit
npx eslint src scripts tests/e2e/calendar.spec.ts vitest.config.ts
npm run build
```

In one terminal, start the built application:

```powershell
npm run start -- --port 3130
```

In another terminal:

```powershell
$env:CALENDAR_TEST_URL = 'http://localhost:3130'
npx playwright test tests/e2e/calendar.spec.ts
```

Without that environment override the calendar browser tests target the existing local integration runner on port 3137. They use controlled API responses and do not need hosted database writes.

## Readiness boundaries

- No additional SQL is required if `supabase/calendar-forecasts.sql` was already applied. Preserve its database timestamp default and server-only access. Existing legacy archive rows are not proof of pre-release knowledge; new trustworthy coverage starts with v2. Genuine consensus revisions before release are ignored under the documented first-numeric-forecast policy.
- Feed cache freshness remains one hour, with browser polling every 15 minutes. Archive health/results are cached up to 60 seconds; merged bias results add their own 60-second cache. Health changes may therefore take roughly two minutes to reach a fresh bias request, plus the browser's polling interval. Separate server processes can perform duplicate cold-cache archive operations; immutable database conflicts preserve correctness.
- The live check had no eligible released surprise. Its 31 pre-release forecast records do not establish that actuals have arrived or that scoring has occurred. Timing, revision, and missing-consensus correctness are established by regression tests, not by an observed live release in this run.
- Trading probability remains **unvalidated**. Existing historical evidence is trend/market-only, with one qualified non-overlapping holdout position, no complete historical news/consensus archive, and illustrative costs. These software repairs do not create the samples needed to claim a high win probability.
- This pass covers the changed macro dashboard/calendar paths. Unchanged journal/auth flows and hosted SMTP, production deployment configuration, permissions, and broker execution were not re-certified here. No production environment was deployed or tested in this pass.

## Commit guidance

Commit the intended source, tests, SQL, dependency changes, and updated documentation together after reviewing the diff. Several required modules are still untracked; a tracked-files-only commit would omit them. Stage explicit paths and preserve unrelated plans, `.artifacts`, `.hallmark`, `.playwright-mcp`, and pre-existing `tsconfig.json` changes. Never include `.env.local`, credentials, raw validation datasets, or browser artifacts. The local verification server was stopped after the checks.
