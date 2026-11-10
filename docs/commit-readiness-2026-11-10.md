# Commit readiness — scoring and economic calendar

> **Historical review, superseded:** C1–C7 are now addressed in the working tree. See [the current production-readiness report](production-readiness-2026-11-10.md) for the current recommendation and verification. The original review below preserves the pre-fix findings and its former HOLD decision; it does not describe the repaired tree.

**Decision: HOLD the release-ready commit.** The SQL table works, all 244 existing tests pass, and the application builds. The six defects from the previous review are repaired. However, the new calendar integration has two confirmed defects in how it establishes that a forecast was known before release. Those can feed incorrect surprises into the bias engine.

Reviewed on 2026-11-10 on **`feature/dashboard`**, against HEAD `5137e8d48842b14bbc819f239ab1d3ddcd23d591`. Scope includes the current tracked diff and new scoring, backtest, calendar, SQL, and test files. This report supersedes the earlier review's release recommendation for the current working tree. No application fixes, staging, commits, pushes, or deployments were performed during this verification; local diagnostic files and this report were added.

## Verified results

| Check | Result |
|---|---|
| Unit suite, `npm test` | **244 passed / 33 files** |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed, including `/api/calendar` |
| `npx eslint src scripts vitest.config.ts` | 0 errors; 1 existing unused-variable warning at `src/lib/__tests__/engine.test.ts:122` |
| `git diff --check` | Passed; line-ending conversion notices only |
| Supabase service-role read | Table exists and is readable |
| Archive after normal app requests | **105 rows**, including 33 sampled rows with non-null forecasts and recorded timestamps earlier than release |
| Live `/api/calendar` | HTTP 200, **105 events**, ForexFactory source |
| Live `/api/bias` | HTTP 200, **5 assets**, `macro-v3.2-4h-2026-11-10` |
| Backtest provenance | Replay hash matches evaluation; price hashes match; report contains current model and evaluation hash |
| Backtest row counts | 8,335 replay/evaluation rows; 2 valid qualified rows before overlap filtering |
| Browser normal controls, controlled calendar fixture | Week toggle and reload persistence work; no page errors; no horizontal page overflow at 1366px and 390px |

The database was initially empty, then ordinary app requests populated its 105 rows. This confirms that the user's SQL ran successfully and that the app can write/read the table. “Success. No rows returned” is consistent with this schema-creation SQL. The verification did not alter database schema, remove rows, or create synthetic rows in the connected database.

The table's SQL enables RLS with no public policies. The live access test used the server credential; it was not a separate audit of every database privilege. Credentials were not printed or included in the report.

The current live calendar response contained **zero actuals**, and bias source health reported `economic_calendar: empty`. A populated forecast archive does not retrospectively establish pre-release knowledge for already-released events. The live check therefore confirms ingestion/connectivity, but does not establish that an actual release surprise has been correctly processed end to end.

## New findings

### C1 — P1 / High: scoring ignores the frozen archived forecast

Locations: [archive.ts](../src/lib/calendar/archive.ts#L13), lines 13–19; [surprises.ts](../src/lib/calendar/surprises.ts#L12), lines 12–17.

`archiveForecasts` stores the forecast but reads back only `id` and `first_seen_at`. `buildCalendarSurprises` then compares the actual against **the latest feed's forecast**, using the old event timestamp to authorize it.

Reproduced with the production functions:

- Actual: **0.4%**. Forecast first seen before release: **0.3%**. Result: inflation **high**.
- Same event, actual, and pre-release timestamp; current feed forecast changes to **0.5%** after release. Result: inflation **low**.
- If the archived event originally had `forecast: null`, a consensus that appears only after release is also accepted using that event's earlier first-seen timestamp.

This defeats the central guarantee of the archive and can reverse economic input direction. It does not mean the final five-asset score necessarily flips every time; other inputs and gates still apply.

**Required repair:** score the actual against a frozen forecast proven to have been observed before release. Track first observation of a non-null forecast, not merely the event. Define how genuine pre-release forecast updates are versioned. Add integration regressions for changed forecasts and an initially missing consensus.

### C2 — P1 / High: request-start timestamps can falsely authorize late forecasts

Locations: [index.ts](../src/lib/calendar/index.ts#L21), lines 21–23; [archive.ts](../src/lib/calendar/archive.ts#L14).

`getCalendar` waits for the feed, then writes the earlier request-start `asOf` into `first_seen_at`, overriding the database's `now()` default.

Reproduced with a controlled clock and the actual service/archive functions:

| Event | Time |
|---|---|
| Request starts | 13:29:59 |
| Scheduled release | 13:30:00 |
| Feed arrives | 13:30:01 |
| Timestamp written to archive | **13:29:59** |

The engine can subsequently treat a forecast received after release as pre-release evidence. Supplying a historical `asOf` to this function also permits historical timestamp writes, although current API callers use their current request time.

**Required repair:** timestamp actual observation or database receipt using a trusted clock. Separate historical/as-of reads from live ingestion so a caller cannot create backdated archive evidence. Test a request spanning release time.

### C3 — P2 / Medium: calendar refresh failures are invisible after first success

Location: [EconomicCalendar.tsx](../src/components/calendar/EconomicCalendar.tsx#L74).

After an initial successful load, the catch handler retains `ready`. A later failed refresh leaves old events displayed with no stale warning, last-success time, or Retry button. During a prolonged outage that can leave last week's events looking current.

Browser reproduction: initial successful calendar fixture, followed by HTTP 503 on refresh. The table remains visible; Retry count is 0; no stale/unavailable warning appears.

**Required repair:** retain useful cached events while visibly marking refresh failure and providing retry and last-success time. Add a browser/component regression for success followed by failure.

### C4 — P2 / Medium: filter controls fail when local storage writes are blocked

Location: [EconomicCalendar.tsx](../src/components/calendar/EconomicCalendar.tsx#L62), lines 62–63 and 86–88.

Filters are derived entirely from local storage. If `setItem` throws, the error is caught, but there is no in-memory update. Currency, impact, and Today/Week controls do nothing. The comment describing only a reset on reload understates the problem.

Browser reproduction: throw from `Storage.prototype.setItem`, click **This week**. Its `aria-pressed` stays **false**. The same interaction works and persists in the normal-storage browser check.

**Required repair:** keep usable in-memory filter state and treat persistence as optional. Test blocked storage separately from malformed stored JSON.

### C5 — P2 / Medium: archive failure is reported as an empty calendar signal

Locations: [archive.ts](../src/lib/calendar/archive.ts#L15), [index.ts](../src/lib/calendar/index.ts#L30), [api/index.ts](../src/lib/api/index.ts#L34).

Database write/read failures are swallowed into an empty map. The calendar endpoint can still return feed success, while scoring reports `economic_calendar: empty`, indistinguishable from a healthy week with no eligible surprise. Failure correctly prevents surprise scoring, but operators cannot tell that its evidence archive is unavailable.

**Required repair:** return separate archive health and expose degraded scoring coverage without exposing database details or credentials. Preserve the calendar display when the archive fails.

### C6 — P3 / Low: avoidable repeated database work

[The bias route](../src/app/api/bias/route.ts#L77) requests `getCalendar` after ingestion may already have called it. The calendar panel also makes its own request. Each service call upserts and reads the full weekly feed. This is unnecessary database traffic, particularly on a public dashboard; it is not a demonstrated scoring error or outage.

**Suggested repair:** share/cache the calendar service result or archive once per feed refresh, while preserving trustworthy observation times and retrying archive failures.

### C7 — P3 / Low: documentation describes superseded behavior

`docs/macro-alignment-v3.md` still describes the original model and Finnhub entitlement as the blocker for structured surprises. Production now uses the ForexFactory/FRED path and model v3.2. The old review leads with a HOLD verdict and appends its later resolution.

**Suggested repair:** update the implementation guide and clearly mark historical findings/resolutions. Use this report for the current recommendation.

## Prior review findings: repaired

| Previous finding | Current status |
|---|---|
| UNRATE 4.4→4.6 rounding selected the wrong regime | Fixed; change rounded before comparison; boundary tests exist |
| Regional Fed manufacturing surveys treated as policy tone | Fixed; activity mapping and scorer-path tests exist |
| Future invalid/duplicate market bars altered past replay | Fixed; integrity checks apply to known completed bars |
| Report mixed current acquisition with old evaluation | Fixed for price/provider provenance; manifest and changed-input checks exist |
| Daily FRED cache keys persisted indefinitely | Fixed; Redis writes include `px` TTL |
| Threshold helpers duplicated production logic | Fixed; production and compatibility exports share classifiers |

The additional exact-threshold yield floating-point fix also has regression coverage. Dashboard sorting still applies absolute bias >=50 to both signs. Live and replay share the scorer, and the four-hour evaluator retains corrected directional labels, entry timing, continuous holding windows, and overlap/purge rules.

## Evidence and limits

Two read-only reviewers checked the backend and the remaining scoring/UI changes. No application code was changed by the reviewers. Deterministic diagnostic output is under `.artifacts/commit-verification-2026-11-10/`:

```powershell
npx vitest run --config .artifacts/commit-verification-2026-11-10/calendar-diagnostic.config.ts
node .artifacts/commit-verification-2026-11-10/browser-check.cjs
node .artifacts/commit-verification-2026-11-10/provenance-check.cjs
npx tsx .artifacts/commit-verification-2026-11-10/database-check.ts
```

The diagnostic's one passing case **confirms the bugs remain reproducible**; it is not a passing correctness regression. Its database responses and clock are mocked, so it does not write synthetic production rows. The 244 existing source tests remain a separate passing suite.

The collaborative browser snapshot timed out twice with `Preview automation snapshot timed out after 15000ms.` Local Playwright was used as the fallback. The initial live-browser table wait also timed out, so control/failure cases were exercised with a deterministic intercepted calendar response. Live endpoint connectivity and the real 105-event dataset were checked separately. The browser evidence does not certify every row or every device layout.

Backtest files match their recorded hashes and model version. They remain a **trend/market-only diagnostic**, with no full historical calendar/news reconstruction and insufficient qualified samples. Connecting the forecast table today does not improve the historical sample retroactively. Passing software checks does not establish a trading win probability.

## Commit recommendation

Fix **C1 and C2 before treating this as a release-ready change**, then address the user-visible failure behavior in C3/C4 and archive-health visibility in C5. Convert the diagnostic scenarios to correctness regressions, rerun the suite/typecheck/build, and update the report. Review whether existing archive rows need a stricter evidence cutoff under the repaired design rather than assuming their timestamps prove consensus availability.

The current branch is `feature/dashboard`. No commit or push has been made during this verification. Required new modules/tests/SQL are still untracked alongside unrelated artifacts/plans. Stage intended files explicitly; a tracked-only commit would omit required files, while `git add .` would collect unrelated local material. Keep `.env.local`, raw validation data, browser profiles, and local diagnostic/screenshot folders out of the commit.

**Result: SQL verified; builds/checks pass; new calendar scoring defects remain. Hold the release-ready commit pending repairs.**
