# Screenshot integration verification — 2026-11-23

Environment: Windows, isolated Supabase project `macroflow-screenshot-eval` (API 55721, Postgres 55722), real Storage, Next development app at localhost:3004. No hosted database or production flag was changed.

Commands and results:

- `npx playwright test --config tests/screenshots/playwright.config.ts` — **15 passed**, 1.7 minutes, after the final implementation fixes.
- Focused `compression.spec.ts` browser test — **1 passed**, 13.8 seconds. Together these cover all **16 screenshot API/browser tests** in the final tree.
- `node tests/screenshots/worker.integration.mjs` — **7 integration scenarios passed**, with actual local Storage uploads/downloads/removals.
- `npx eslint tests/screenshots` — passed with no warnings or errors.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-screenshot-eval.ps1 -BaseOnly` — created an independent local database with all base migrations and real Storage.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-screenshot-eval.ps1 -AppOnly -SetupOnly` — verified local configuration and repeatable evaluator seeding.

The API/browser checks cover private persistence and authenticated downloads, retry identity and conflicting retry content, owner/anonymous/origin isolation, three-slot concurrency and immutable replacements, malformed/type/size/pixel validation, single-trade deletion, MT5 retain then purge, deletion freeze and Auth cascade metadata, paste autosave with Cancel/reload persistence, mobile file selection and Retry, accessibility of the screenshot section, rapid paste capacity, a lost successful upload response, and navigation guards with a pending upload. Final regression checks also cover cancelling browser Back while retaining a failed preview and applying the upload-attempt throttle before decoding, including repeated successful operation IDs.

Both **Chromium and Microsoft Edge** passed a real Windows clipboard test: capture the rendered editor to PNG, put it on the native clipboard through a hidden STA helper, focus Notes, press Control+V, wait for Saved, then reload and verify the image. The helper restores the prior clipboard if it has not been changed again. Headless native-clipboard trials failed because those browsers use an internal clipboard; the final tests use isolated browser windows positioned off-screen.

The seven Storage-worker scenarios verify paginated/repeatable legacy backfill; retry after a simulated Storage outage; concurrent worker claims; old cleanup after display-slot reuse; removal of an object arriving after a cleanup job completed; recovery of a request that uploaded bytes but never finalized; deletion after Auth removal; and authorization on the shared scheduled-worker handler. (The outage and concurrency assertions share one scenario.) The final run repeated all seven successfully after the rate-limit migration change.

The real browser compression test sent an 8,651,943-byte synthetic chart PNG through the application's canvas preparation and normal upload path. The stored result was a 789,136-byte WebP at the original 3200×1800 dimensions. Before/after crops of the chart heading, prices, and entry annotation were inspected visually and remained clearly readable. Artifacts are in `.artifacts/screenshot-eval/compression/`; this is evidence for that fixture, not a guarantee for every possible chart.

Whole-project and database verification:

- `npm test` — **794 tests passed across 63 files**.
- Existing account-management Playwright suite — **9 passed**.
- Existing account-funds and CSV-import Playwright suites — **6 passed**.
- `node scripts/test-screenshot-concurrency.mjs` — **4 deterministic two-connection race scenarios passed**: finalization/deletion, reservation/deletion, row-first deletion fail-fast, and deletion-freeze/Auth-cascade fencing.
- `node scripts/test-screenshot-cleanup.mjs` — **3 real Storage cases passed**: normal deletion, delayed upload cleanup, and Auth-deletion cleanup.
- Screenshot SQL lifecycle assertions passed after migration and migration rerun, including attempt-rate window/reset assertions. Existing account-management/compatibility, trading-account/funds/symbol/ingest SQL regressions passed.
- `npx tsc --noEmit`, whole-project `npm run lint`, and `npm run build` — **passed**. The production build was repeated after the final implementation fixes.
- Deno type-check of `supabase/functions/screenshot-cleanup/index.ts` — **passed**.
- `git diff --check` — **passed**.

A final independent code review found two issues: browser Back/Forward could bypass pending-preview protection, and upload retries could bypass attempt throttling. Both received failing regression tests before fixes and passed afterward. Navigation now guards history traversal; the separate database attempt gate runs before image decoding.

An initial integrated test was observed failing while the backend rewrite was incomplete. Subsequent harness corrections used the existing `removedAccounts` API collection and limited the accessibility assertion to the new screenshot section. A preexisting contrast issue on the trade outcome selector was observed outside that section; it is not a screenshot regression.

Coverage limits: native clipboard and navigation behavior were verified on Windows Chromium and Microsoft Edge. Firefox, Safari, and macOS Command+V were not exercised. Hosted migrations, Edge Function deployment, the scheduled invocation, and production hosting limits remain rollout checks described in `docs/journal-screenshots.md`. The worker implementation and authorization handler were exercised locally against real Storage; no hosted rollout occurred.

Raw output is in ignored local paths under `.artifacts/screenshot-eval/` and `.superpowers/sdd/journal-trade-images-plan/`, including `screenshot-final.log`, `unit-final.log`, `account-regression.log`, `journal-regression.log`, `worker-final.log`, `concurrency-final.log`, and `build-final.log`. This committed record preserves the outcomes without including local service credentials.
