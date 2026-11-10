# Production integration review — 10 November 2026

The integration of `feature/dashboard` (`4f3dbbb`) with production `main` (`0e5de53`) passes local release checks. This report supersedes the earlier branch-specific readiness reports. Git publication and hosting deployment are separate operations; the checks below ran against the integrated local production build.

## Integrated behavior

- Preserve the production dashboard design, direct market-analysis pages, twelve instruments, official release schedules, macro panels, and journal accounts, funds, imports, analytics, reviews, and screenshots.
- Rank markets by absolute bias strength. Strong bearish scores receive the same priority as equally strong bullish scores; absolute values of 50 or more precede weaker scores.
- Use the shared four-hour live/replay alignment scorer, distinguish economic trends from actual-versus-consensus surprises, apply regime-dependent equity scoring, and retain evidence/freshness gates. Extend the equity regime rule to US500 and preserve the production currency-country mappings. Incomplete or conflicting evidence cannot produce an aligned trade signal.
- Preserve `/api/calendar` and its official-calendar `{data, meta}` contract. Weekly ForexFactory forecasts, mapped FRED actuals, and archive health use the separate `/api/calendar/consensus` endpoint and overview panel. These are two sources with different coverage and availability.
- Preserve immutable, first-numeric consensus archives with database receipt timestamps and `consensus-v2:` provenance. Use the archived forecast in scoring. No additional forecast SQL is required if the supplied migration was already applied.
- Preserve production provider validation, bounded caches, request coalescing, stale fallback, and daily-history updates. Version merged ingestion as `merged_events_v6`. Reuse the ingested next release instead of fetching the calendar again. Separate Redis history and browser direction-change notices by scoring model.
- Repair the weekly calendar loading indicator's accessibility role. Cover its pending request state with an automated accessibility check; preserve stale warnings, retry controls, and blocked-storage behavior.
- Upgrade Next.js and eslint-config-next from 16.2.9 to 16.4.6 and apply compatible dependency fixes.

## Verification

| Check | Result |
| --- | --- |
| Unit suite | 390 tests passed across 44 files |
| Repository lint | Passed |
| TypeScript | Passed; production build also completed its type check |
| Production build | Passed with dashboard, market pages, official and weekly calendar endpoints, and journal/auth routes |
| Dashboard, market analysis, account-screen browser suite | 28 passed against the production build |
| Weekly calendar browser regressions | 6 passed, including stalled loading accessibility, blocked storage, stale/malformed responses, archive outage, retry, and responsive layout |
| Production dependency audit | Zero vulnerabilities (`npm audit --omit=dev`) |
| Full dependency audit | Seven moderate development-tool findings; zero high or critical findings. Remaining paths involve typescript-eslint/minimatch; forced major upgrades were not applied. |
| Live local bias API | HTTP 200; all twelve symbols returned; individual US500 and EURUSD queries returned only the requested market |
| Live local weekly calendar | HTTP 200; 105 events; `archiveStatus: ok` |
| Live local official calendar | HTTP 200; existing `{data, meta}` response retained |
| Market page and journal access | XAUUSD page HTTP 200; unauthenticated journal request redirected to login |

The live bias response reported market data, RSS, FRED, and archive healthy; Finnhub and eligible economic surprises were empty. All twelve readings were marked conflicted in that snapshot, with probability unvalidated. Provider availability is time-dependent. UI checks use deterministic provider fixtures; separate live requests establish connectivity, rather than a profitable market outcome. The existing official calendar cache tests and production headline, history, and scoring regressions remain covered.

## Limits and historical reports

Software checks do not establish a high-probability trading edge. The historical five-instrument, trend/market-only backtest remains unchanged evidence, with inadequate qualified holdout coverage and illustrative costs. It does not validate the expanded twelve-instrument dashboard. Full historical consensus/news coverage and adequate out-of-sample trading results remain necessary; the API continues to return `probability: null` and `validation: unvalidated`.

The earlier feature readiness report is retained at [production-readiness-2026-11-10.md](production-readiness-2026-11-10.md). The earlier production journal review from main is preserved at [production-readiness-main-2026-11-10.md](production-readiness-main-2026-11-10.md). Their branch-specific counts, endpoint descriptions, and release-status statements describe earlier checkpoints.

This integration did not rerun the disposable Supabase authentication/journal mutation suite, apply SQL, or verify a hosted production deployment. It preserves the existing journal implementation. The hosting integration must build and deploy the pushed main commit before it is live. Production secrets, migrations, email delivery, and authenticated hosted workflows are not certified by local browser fixtures or an unauthenticated redirect check.

## Reproduce

```powershell
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
npm run start -- --port 3130
```

With that server running, use another terminal:

```powershell
$env:MACROFLOW_UI_BASE_URL = 'http://localhost:3130'
npx playwright test --config playwright.ui.config.ts
$env:CALENDAR_TEST_URL = 'http://localhost:3130'
npx playwright test --config playwright.calendar.config.ts
```

The integration was prepared in a separate worktree to preserve unrelated original-checkout edits and local plans. Credential files, audit diagnostics, browser output, and local tooling are excluded from the commit.
