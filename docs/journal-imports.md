# Journal CSV imports

Implemented on `journal-ui-functionaly`. Local preview: `http://localhost:3137/journal`. The hosted database has not been changed.

## Try it

Choose **Add account → Import existing journal**, or **Accounts → Import journal**. Select one existing manual account or fill out a new broker account. New accounts are created only when the import succeeds.

Export a full-page Notion trading database as **Markdown & CSV**, extract the ZIP, and upload its CSV. A downloadable template is available in the file step. Limits: UTF-8, one CSV, 2 MB, 1,000 records, 100 uniquely named columns. Comma, semicolon and tab separators are supported, including quoted/multiline values and a BOM. Source row numbers refer to CSV records, including the header, rather than physical lines in multiline files.

Review suggested column matches and confirm the date format, date meaning, timezone, decimal format and cash mode. Cash is either signed net P&L or Win/Loss/Breakeven plus an unsigned amount. Confirm that cash is after fees. Gross profits and separate fee columns are not automatically combined. Missing prices/cash stay null, and unsupported symbols need an explicit match or correction. Prices do not stand in for account returns.

The review lists every row, with 20 records per page. Invalid and previously imported rows cannot be selected. Possible duplicates require individual selection. Expand a row to correct source values, then refresh the preview; revalidation resets selection. Download review exports original values and diagnostics with spreadsheet formula escaping. Only selected, validated rows are saved, in one transaction.

## Dates, capital and reporting

- Entry-only records without a closing date retain that uncertainty. They can contribute outcomes, but cash cannot affect balance until the closing date is known.
- Closing-only records use their event timestamp as a storage anchor and explicitly record that entry time is unknown. No entry session is attributed to them.
- Date-only records retain their source timezone and calendar day in History, Analytics and Weekly Review. Ambiguous/nonexistent DST times require correction or an ISO timestamp with an explicit offset.
- Choose starting capital before the trades, a known balance as of a date, or set capital later. Existing snapshots are preserved. Cash results on/before a snapshot are already included; only later results add to the balance. The review calculates impact for the selected subset.
- A date-only cash result on the snapshot day is ambiguous and must be corrected/skipped. If a later snapshot correction creates that ambiguity, the balance excludes the uncertain trade and marks coverage incomplete.
- Missing cash/dates produce incomplete balance coverage. Imported custom tags become available in capture and edit choices. Different account currencies are never silently summed.

## Storage and ownership

Apply `supabase/journal-imports.sql` **after** `supabase/journal-account-funds.sql`. It is additive and rerunnable. It creates owner-scoped batches, staged rows, a tag registry and imported-trade provenance. Manual and broker entries still require entry prices; only import-owned rows may omit them.

All HTTP routes require journal access and use server-side ownership checks. Browser database roles cannot read staged values or invoke import functions. The server parses and normalizes uploaded values; a commit uses privately staged rows and rechecks the account, opening version, selection, duplicate identity and validity in SQL.

Account locking serializes concurrent imports. Exact file/row identities and original IDs identify previous imports. Matching executions without a stable ID are possible duplicates. A batch retry with the same selection returns its original result. A different selection on a committed batch fails. Imports do not modify existing trades.

Uncommitted previews expire after 24 hours and are purged on that user's next staging request. Raw CSV files are not persisted. Private source cells, mapping, diagnostics and normalized provenance remain with committed batches. History shows the latest 50 batches; undo reports untouched/edited/removed counts, checks the reviewed count, and removes only untouched import-owned trades. Edited trades, account records, setup tags and opening snapshots stay. Funds then recalculate from the remaining records.

Endpoints: `POST /api/journal/imports/preview`, `POST /api/journal/imports/commit`, `GET /api/journal/imports`, `POST /api/journal/imports/[id]/undo`, `GET /api/journal/setup-tags`.

Not included: Notion OAuth/live sync, ZIP/Markdown bodies, images, attachments, Excel/PDF, fee conversion, FX conversion, files split across accounts, or importing into an MT5-synced account.

## Local verification

`scripts/test-auth-local.ps1` applies the migration twice to disposable Supabase. Run:

```powershell
npx tsc --noEmit
npm test
$env:MACROFLOW_AUTH_TEST_STATUS = Join-Path $env:TEMP 'macroflow-auth-tests/status.json'
npx playwright test tests/e2e/journal-imports.spec.ts tests/e2e/account-funds.spec.ts --reporter=list
```

Tests cover CSV limits/quoting, dates/DST, exact money, unknown values, aliases, corrections, source-calendar reporting, ownership, retry/concurrency behavior, transaction rollback, retained edits on undo, existing account capture/funds and mobile accessibility. Screenshots are under `.artifacts/import-review/`.

Notion references: [exporting your content](https://www.notion.com/help/export-your-content), [relations and rollups](https://www.notion.com/help/relations-and-rollups).
