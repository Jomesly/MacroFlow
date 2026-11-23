# Local screenshot verification

This harness uses a separate disposable Supabase project named `macroflow-screenshot-eval`, including real Storage, on ports **55721 / 55722 / 55724**. The Next evaluator listens on **3004**. Tests reject other Supabase URLs and require the local evaluation response marker before creating any test users.

From this worktree, install dependencies and start the evaluator:

```powershell
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-screenshot-eval.ps1
```

The script installs the existing journal/account migrations and the screenshot lifecycle migration, completes the legacy image inventory, enables screenshots only for the local process, and uses `.artifacts/screenshot-eval/next` for build output. Use `-SetupOnly` to prepare the database without running Next. Use `-AppOnly` to restart Next against the prepared evaluator. The `-BaseOnly` option exists for observing failing integration tests before the lifecycle migration is installed.

For a manual local check, sign in as `screenshot-evaluator@macroflow.test` with the synthetic fixture password `MacroFlow-Screenshots-Local-2026!`. The seed preserves an existing evaluator's images and trades. This login exists only in the disposable local project.

Run the tests in another terminal from the same worktree:

```powershell
npx playwright test --config tests/screenshots/playwright.config.ts
node tests/screenshots/worker.integration.mjs
```

The default status file is `%TEMP%/macroflow-screenshot-eval/status.json`. `MACROFLOW_SCREENSHOT_TEST_STATUS` can point to a different copy of the **same local project** status, but the API URL must still be `http://127.0.0.1:55721`. Keep that file out of source control.

The tests create disposable confirmed identities and synthetic trades, call the real app APIs, and verify stored images using the real local Storage service. They cover private retrieval, repeated request identity, owner isolation, byte/dimension validation, simultaneous uploads, three-slot capacity, removal, trade deletion, MT5 retain/purge, user-deletion freeze, and cleanup metadata surviving Auth deletion.

Browser coverage includes paste into Edit, normal text-only paste behavior, automatic saving, Cancel/reload persistence, retry after a failed upload, reconciliation after a lost success response, guards while uploads are pending, cancelling browser Back with a recoverable preview, rapid-paste limits, mobile file selection, and accessibility checks on the screenshot section. A large synthetic chart also exercises real browser compression and stores before/after crops for readability inspection under `.artifacts/screenshot-eval/compression/`.

On Windows, the suite also captures the rendered trade editor to a PNG, places it on the Windows clipboard using a hidden STA PowerShell helper, then presses **Control+V** in Chromium and installed Microsoft Edge. The browser window is positioned off-screen because headless browsers use an internal clipboard. This exercises the operating-system clipboard event path rather than dispatching a synthetic event. The helper retains prior clipboard contents only in process memory and restores them afterward if the user has not replaced the test image. It never logs clipboard contents. Microsoft Edge must be installed for its test.

The worker integration script invokes the same runtime-neutral cleanup implementation as the scheduled Edge Function, using the real local database and Storage. It verifies paginated legacy backfill, transport-failure retries, concurrent claims, delayed deletion after slot reuse, a late Storage object after completed cleanup, recovery of an expired upload, Auth-deletion cleanup, and authenticated worker invocation. It deliberately advances only its disposable upload's lease timestamps and one fixture object's creation timestamp to avoid waiting minutes in the test. Run it after the browser suite so it can also drain that suite's cleanup jobs.

Screenshot failures and traces go under `.artifacts/screenshot-eval/test-results`. The test users are removed at the end of each test; attachment tombstones remain available for cleanup verification. No production flag or hosted database is changed by this harness.
