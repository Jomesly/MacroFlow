# Journal accounts and CSV import

Status: implemented in the working tree and verified against disposable local Supabase. Hosted database migrations have not been applied. See [current implementation and setup](../journal-imports.md).

The proposal below records the original design. Account identities, multi-account capture and capital tracking were subsequently implemented; see [trading accounts](../trading-accounts.md) and [account funds](../account-funds.md).

## Product direction

One signed-in user can own several named trading accounts. Each trade belongs to exactly one account. An account can contain manually entered trades, imported history, and optionally an MT5 connection. Import is a way of adding trades, not an account type.

Examples: Personal USD, FTMO Challenge, Demo Practice. An account is a journal grouping; it is separate from the user's login.

First-release boundary: CSV imports target journal accounts without an MT5 connection. Linking an imported account to MT5 is deferred until broker-ticket reconciliation is implemented, because a later EA backfill could otherwise duplicate imported history. Keep imported history and automatic MT5 history in separate accounts during this release.

## Original baseline (before implementation)

- JournalView owns the journal tabs, but no shared account selection.
- LogTradeForm and createTrade do not accept an account; manually entered trades have no broker account.
- broker_accounts models MT5 login/server identities. Its required fields make it unsuitable for named manual accounts.
- Analytics and Weekly Review already filter by broker account IDs. They must move to the new journal account ID, including manual and imported trades.
- The manual trade API assigns the current time and requires an entry price. Historical import needs a separate validated path with original dates and explicitly missing data.
- Trade symbols are currently limited to XAUUSD, GBPUSD, US100, DJ30, and BTCUSD.

## User experience

1. Place a compact account selector and Add account button immediately above the journal tabs, before Capture the trade. Show the selected account and currency consistently across Log Trade, History, Analytics, and Weekly Review.
2. Remember the last valid account per signed-in user. Include the selection in navigation URLs; an inaccessible or deleted ID must never silently fall back to a different save destination.
3. Add account opens an accessible modal with Create account and Import journal choices. Small screens use a full-width dialog with bounded scrolling. Preserve the compact page header.
4. Create account asks for a name and base currency. Optional classification: Personal, Evaluation, Funded, or Demo. No balance field in the first version; accurate equity and return calculations need deposits and withdrawals too.
5. After creation, select the account and focus the trade form. Allow account renaming. Currency becomes immutable once the account contains trades or has a broker connection.
6. Import journal asks for an existing target account or a new account, then opens the import wizard. A failed or canceled import must not create an empty account: create a new account with its trades in the commit transaction.
7. Keep drafts per account in memory, scoped to the current signed-in user; switching accounts restores the matching draft. Clear drafts on logout/account switching between users. After a save, retain the selected account.
8. All accounts is a read-only scope for History, Analytics, and Weekly Review. Log Trade always resolves to one explicitly selected account and displays its name next to the save action. Preserve separate per-account money summaries; do not sum currencies or account returns.
9. Rename Connect Account to Accounts and house account management, import history, and the existing MT5 setup there.

## Import workflow

Supported initial input: one UTF-8 CSV file, including a CSV extracted from a Notion Markdown & CSV export. One target account per import; split a file containing multiple accounts before uploading in the first release.

1. Upload: proposed limits of 2 MB and 1,000 data rows, enforced on the server too. Parse with a maintained CSV parser that supports quoted commas, escaped quotes, BOMs, and multiline notes.
2. Map columns: suggest mappings from headers, then require the user to review them. Example mappings: Date to Trade date, Pair to Symbol, Buy/Sell to Direction, Profit to Net P&L, Strategy to Setup tags, and Journal notes to Notes.
3. Normalize values: confirm date format, date meaning, timezone, decimal separator, and currency. Offer explicit aliases such as Gold to XAUUSD and Buy to Long. Unknown instruments require correction or skipping; never substitute another instrument automatically.
4. Preview every row's status: Ready, Needs correction, or Possible duplicate. Show original row numbers, normalized data, and exact error reasons. Include counts and a downloadable rejected-row CSV that escapes spreadsheet formulas.
5. Commit only the reviewed valid subset after an explicit action labeled with its count and target account. Invalid rows stay out. Atomically commit that subset so failures cannot leave a half-imported batch.
6. Show the actual inserted and skipped counts, date range, account, and a link to History. Provide batch history and Undo import with a concrete preview. Undo only untouched, import-owned rows; edited rows are retained and reported. It cannot delete pre-existing or MT5-owned trades.

## Data interpretation

- Require a valid trade date, supported symbol, and direction. Require result or signed net P&L for rows declared closed; infer result from signed net P&L only when no result is supplied. Conflicting result and P&L values require correction.
- Ask whether a single source date represents opening or closing. Preserve that meaning: do not invent an opening timestamp for close-only records. Add explicit date precision/provenance when needed; date-only values must remain identified as date-only.
- Missing entry/exit prices, net P&L, or R stay null. Historical imported rows may omit entry price; manual entry and MT5 ingestion keep their existing validation. Update shared trade types and history/edit views to display missing values safely.
- Derive price-return percentage only from valid entry/exit prices and direction. Do not map a Notion account-return percentage into MacroFlow's price-return field. Unmapped values remain in import provenance and are excluded from calculations.
- Net P&L means realized profit/loss after fees. Gross P&L requires an explicit fee mapping before it can become net. Money values must match the account currency; no FX conversion in this release.
- Keep monetary and R metric coverage visible. An imported win without a money value contributes to win rate, not cash profit.
- Allow imported setup tags using a shared user-owned tag registry, so form choices and history filters remain consistent. Preserve unrecognized source columns in private per-row import metadata and show which columns do not affect reports.
- Imported historical trades must not receive today's market context or bias snapshot.

## Notion scope

Notion supports exporting database properties as CSV. Export the trading database using Markdown & CSV, extract it, and upload its CSV. The first release imports supported table properties; it does not ingest full page bodies, images, comments, ZIP archives, relations, or live Notion synchronization. A Notes database property can be mapped; notes written inside a trade's Notion page need later Markdown/ZIP support. Relation exports can contain URLs rather than display values, so show the raw values in mapping preview and require a usable mapping.

References:
- https://www.notion.com/help/export-your-content
- https://www.notion.com/help/relations-and-rollups

## Storage and API design

- Add journal_accounts: id, user_id, name, currency, optional category, created_at, updated_at.
- Add trades.journal_account_id, retaining broker_account_id and the existing broker ticket deduplication key.
- Attach broker_accounts to journal_accounts with a unique, owner-consistent mapping. Initially one MT5 identity per journal account. New MT5 identities create a journal account automatically; later attaching an existing manual account requires explicit confirmation of the broker identity and currency.
- Add import_batches and import_rows: owner, target account, status, source, filename, file hash, mapping configuration, row identifier, normalized values, diagnostics, and inserted trade ID. Add imported trade source/provenance without treating it as a broker ticket.
- Add per-user setup tags and trade tag references or a backward-compatible registry over the existing tag array. Deduplicate tag names case-insensitively; preserve current tags.
- Retain the existing /api/journal/accounts response for MT5 callers. Add /api/journal/trading-accounts for named account listing/creation, /[id] for renaming, and /api/journal/imports for preview/commit/history/undo operations.
- All reads, writes, previews, commits, and undo requests validate authenticated user ownership. Match the repository's server-only service-role access and deny browser database access; use ownership-consistent database constraints as a second boundary.
- A database function commits the selected rows, optional new account, provenance, and batch status in one transaction. Revalidate rows and account ownership inside that transaction; do not trust client preview results.
- Use an idempotency key scoped to the owner and batch. A retry returns the existing result. Stable source row IDs prevent repeat insertion when available. Identical file/target/mapping imports are detected before commit. Fingerprint matches without stable IDs are possible duplicates that the user can keep or skip; two similar trades are not automatically deleted.
- Imported rows never update existing manual or MT5 trades. Suspected overlap is shown for review. Concurrent commits and retries are covered by database uniqueness/locking, not only disabled buttons.
- Prefer local parsing for mapping suggestions; upload the reviewed payload only when server validation is requested. Store normalized staging privately with a short expiry (proposed 24 hours); retain committed batch provenance. Do not retain or log the raw file by default.

## Migration and release sequence

1. Account foundation: additive schema, owner constraints, backfill, account APIs, and rollback-compatible reads. Create one journal account per existing broker identity. Move existing unassigned manual trades into My journal. Preserve known broker currencies; mark unknown currency as requiring setup rather than guessing. Ask for the default manual account's currency on first use. Verify every trade is assigned before enforcing non-null account IDs.
2. Account experience: selector, create/rename dialog, account-specific save, scoped history/reports, draft preservation, and Accounts management. Update EA account creation and ingestion mapping without changing existing ticket identity.
3. Import foundation: parser, mapping, dates/currency/symbol validation, nullable historical price support, private staging, atomic commit, duplicate handling, and provenance.
4. Import experience: wizard, preview counts, row corrections/skips, batch history, safe undo, and downloadable template/error report.
5. Release checks: run migration against a disposable database first; deploy behind feature flags, validate counts and ownership, then enable. Rollback disables new account/import writes while retaining all migrated records and additive schema; do not roll back to an old unscoped journal UI that can mix accounts.

Ship the account foundation and selector first for evaluation, then the CSV import increment.

## Acceptance criteria

- Create two accounts, log to each, and switch all journal views without cross-account data or drafts appearing.
- Renaming preserves trades and MT5 identity. Currency cannot change after activity. Existing manual and MT5 records survive migration with unchanged counts and broker identifiers.
- A forged account ID cannot be read, written, imported into, linked, or undone by another user.
- CSV quoting/multiline notes, ambiguous dates, date-only trades, DST timezone cases, decimal commas, unsupported symbols, missing values, custom tags, and conflicting results produce correct previews.
- Imported close dates put trades in the correct weekly review; missing prices and monetary fields do not become zero or misleading computed results.
- Repeating or retrying a commit inserts no duplicates; possible duplicates can be kept explicitly. Concurrent commits produce one authoritative result.
- Simulated commit failure leaves no partial batch or empty new account. Undo cannot delete edited, pre-existing, or MT5-owned trades.
- Keyboard users can operate the selector and modal, focus returns correctly, and mobile layouts fit without horizontal overflow.
- Existing MT5 ingestion, authentication isolation, journal screenshots, and reporting checks pass after the migration.

## Deferred

Live Notion OAuth/sync; Markdown/ZIP/page-image import; Excel/PDF parsing; broker statement parsers; bulk splitting across account columns; arbitrary instrument catalogs; account merging/deletion/archiving; broker equity synchronization; cross-currency totals. Manual balance snapshots and deposit/withdrawal tracking are now implemented. These require separate rules and should not delay the first account-and-CSV release.
