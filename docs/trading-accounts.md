# Broker identities and journal accounts

Each named trading account has a broker or firm, an account number/ID, an optional nickname, a currency, and an optional broker server. Labels keep the identity visible: `Funded account · IC Markets · 00123456 · USD`. Account IDs are strings, preserving leading zeros and alphanumeric values.

The broker selector provides convenience names and an **Add a different broker** option. Custom names are reused from that user's existing accounts. These labels do not create a broker API connection. MT5 remains configured separately in **Accounts**.

The account selector scopes History, Analytics, and Weekly Review and selects the default logging draft. Drafts stay in memory per trading account (including All accounts) and are discarded when the signed-in user changes or the page reloads. Only the reporting account ID is remembered in user-scoped local storage and the current URL. On Log Trade, the Trading account dropdown contains checkboxes for one or more manual save destinations. Changing these checkboxes keeps the current draft intact; selections remain after saving. All accounts starts with no destinations selected. Money totals spanning different accounts are hidden.

Nicknames can be changed without changing trade ownership or broker identifiers. Duplicate broker/account/server identities are rejected case-insensitively. Use a server when the same broker reuses an account ID across servers. Broker identities and known currencies remain fixed; legacy accounts with an unknown currency can select their initial currency in Account details.

Manage funds opens per-account opening balances, deposits, withdrawals, fees, corrections and change history. See [account funds and shared entries](account-funds.md).

## Database setup

Before running this version against a configured Supabase project, apply `supabase/trading-accounts.sql` after the existing schema, signup/login, and journal autosync migrations, then apply `supabase/journal-account-funds.sql`. Both are transactional and rerunnable. Test against a preview or disposable database before applying them to a database containing real records.

The migration:

- Creates `journal_accounts` with server-only access and owner-consistent foreign keys.
- Creates one journal account per existing MT5 broker identity and a **My journal** account for previously unassigned manual records. It does not infer an unknown broker or currency for old manual trades.
- Assigns every existing trade to its journal account while retaining broker IDs and ticket deduplication.
- Assigns new MT5 records to their linked journal account using database triggers, including newly connected accounts that have not sent any trades.
- Keeps older manual clients compatible: a trade without `journalAccountId` goes into that user's **My journal**, never an arbitrary recently selected account.
- Leaves existing account nicknames intact on rerun.

No migration is automatically applied to the Supabase project in `.env.local`. Missing migrations cause account loading to fail safely rather than showing an unscoped trade form.

## Verification

`powershell -NoProfile -File scripts/test-auth-local.ps1 -TestPattern 'broker accounts'`

This provisions only the dedicated disposable Supabase project on ports 55321/55322, verifies migration/backfill/rerun/ownership assertions, and exercises account creation, duplicate handling, nicknames, drafts, scoped history, MT5 provisioning, keyboard focus, and a mobile accessibility check. It never uses hosted `.env.local` credentials for database writes. The test app runs on port 3137.

CSV/Notion import is implemented; see `docs/journal-imports.md` for its workflow and required migration.
