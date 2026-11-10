# Account funds and shared trade entries

## Local setup

Apply `supabase/journal-account-funds.sql` after `supabase/trading-accounts.sql` and its existing prerequisites. This is additive and rerunnable. Existing trades retain their account, broker identity, timestamps and monetary values; opening balances are never fabricated or backfilled from trade prices.

The migration has been applied to disposable local Supabase on port 55321. The app preview using that database runs at http://localhost:3137/journal. It has not been applied to the hosted project configured in `.env.local`.

## Logging to multiple accounts

On Log Trade, open the Trading account dropdown and check up to 20 manual accounts. The trade form has no separate account checklist. The current individual account is initially selected; selections remain after saving. All accounts requires explicit selection. History, Analytics, and Weekly Review retain their single-account or All accounts reporting filter.

The capture form uses the original compact layout: Logged At, symbol, direction, entry price, optional exit price, price-return preview, Win/Loss/Breakeven, tags and notes. These values are copied to each checked account. An exit price requires a result. Without a result, the trade stays open. The displayed capture timestamp supplies entry and closing timestamps for this quick-entry flow, and stays stable during retries. The closing timestamp can be corrected in History.

The preview is a percentage change in price, not cash profit. Choosing Win or Loss reveals an amount field. Enter a positive net cash amount: Win adds it to the recorded balance and Loss deducts it when the trade saves. Breakeven records zero without an amount field. Win/Loss requires a nonzero amount, and every selected account needs its currency set. The same amount applies to each selected account in that currency; mixed currencies get separate labeled amount fields without conversion. Decimal validation respects each currency's precision. Open entries carry no cash result.

Each account's prices, closing timestamp and net P&L can still be edited independently in History. Net P&L includes trading fees; its sign determines the outcome when known. Older closed entries without cash P&L continue to show incomplete cash coverage until corrected.

One transaction creates a group and one independent trade per selected account. No partial saves occur if a destination fails validation. Owner-scoped request IDs deduplicate retries and reject changed content under the same ID. Editing, closing, reopening or deleting one copy never changes another account's record. History distinguishes account trade counts and trading-decision counts. Old ungrouped rows each count as a decision; no historical relationship is guessed.

MT5 accounts are visibly disabled as manual batch destinations because sync already records their trades. Reconciliation with broker tickets is required before supporting manual copies to synced accounts. MT5 execution fields are read-only in History; notes and tags remain editable.

## Managing money

Choose Manage funds in the account bar, a balance card, or Accounts. Set an opening balance with a date/time matching the account's already-recorded statement balance. Transactions and realized trades **strictly after** that instant contribute to the balance; activity at or before it is included in the opening snapshot. The displayed timezone is the browser's local timezone; times are stored as timestamptz.

- Deposit and withdrawal: enter a positive amount; the server applies the sign.
- Adjustment increase/decrease: correct a real difference with a required reason.
- Standalone fee: only for charges not already included in a trade's net P&L.
- Edit: correct amount, date, kind or note with a required correction reason.
- Void: remove an entry's effect once, retaining its history and a required reason.
- Correct opening: retain earlier opening versions and require an explanation. The new cutoff cannot move past an effective cash entry.

Cash entries require an opening snapshot, a known currency and a later effective date. Future activity is not supported. Amounts use decimal strings and exact arithmetic, with up to 15 whole digits and currency-specific fractional precision (up to 8 for supported crypto currencies). Negative resulting balances can be recorded; the preview identifies them. Initial currency can be supplied for legacy accounts through Account details; known account currencies remain fixed in the application.

Recorded balance = opening + deposits − withdrawals + signed adjustments − standalone fees + net realized trade P&L.

Deposits, withdrawals and adjustments do not affect trading profit, win rate or trade count. Cash results missing an amount or a trustworthy closing date produce an incomplete-coverage indication, not a zero result. No opening snapshot means no computed balance. Open-trade floating P&L is excluded. MT5 money P&L already includes commission and swap; broker cash movements are not automatically synced, so synced-account funds history is explicitly manual and coverage is not claimed complete.

## Storage and API

- `journal_trade_groups` and `trades.trade_group_id` link shared decisions; owner-composite foreign keys and a group/account uniqueness index prevent misassignment.
- `trades.pnl_amount_exact` exposes the existing numeric as text for lossless editing. Existing numeric API fields remain compatible with analytics. `revision` protects current History edits against stale writes.
- `journal_account_funds` stores the effective opening snapshot.
- `journal_cash_entries` stores current effective entry versions and void state.
- `journal_fund_revisions` retains before/after states and reasons with exact amount strings.
- `journal_fund_requests` stores idempotent mutation responses.
- `journal_trade_revisions` records updates/deletions, including monetary/date/status changes and broker sync updates.

All new tables have RLS and no anon/authenticated grants. Server-only RPCs enforce account ownership and repeat validation within each transaction. Mutations serialize account changes and use version checks for corrections. Balances are derived from all eligible ledger rows and realized trades rather than a separately maintained counter. Current History uses optimistic versions; the older single-trade API remains available for existing clients. Requests without explicit destinations still follow the earlier default-account behavior.

- `POST /api/journal/trade-batches`: shared fields, per-account executions, request ID.
- `GET /api/journal/trading-accounts/:id/funds?offset=0`: complete derived summary and 50 history entries, with revision histories. Load older entries pages the list; summary totals always include every eligible record.
- `POST /api/journal/trading-accounts/:id/funds`: request ID and a `set-opening`, `add`, `edit` or `void` mutation.
- `PUT /api/journal/trade/:id`: `expectedRevision` plus entry/exit/result, exact `netPnl`, `closedAt`, notes and tags. Linked siblings remain unchanged.

## Verification

`npm test` covers decimal precision, amount bounds, batch validation, independent result normalization, unknown cash results and correction reasons alongside the existing suite.

`supabase/tests/journal-account-funds.sql` runs inside a rolled-back fixture transaction: atomicity, retries/conflicts, owner isolation, MT5 exclusion, deposits/withdrawals/adjustments/fees, edits/voids, stale versions, opening boundaries, trade reopening/deletion/audit, currency precision and browser-denied permissions.

`tests/e2e/account-funds.spec.ts` exercises the real APIs and UI against isolated Supabase: concurrent duplicate submissions, ownership, unknown results, exact crypto amounts, shared logging, independent edits, reopening, funds corrections/voiding, desktop/mobile layouts and Axe accessibility checks. The isolated runner `scripts/test-auth-local.ps1` applies and reruns the new migration before those tests. It never mutates the hosted database.

Automated broker cash sync, account transfers, bulk trade closure, FX conversion, position-size calculations and CSV/Notion import remain separate features.
