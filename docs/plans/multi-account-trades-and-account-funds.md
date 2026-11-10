# Multi-account trade logging and account funds

Status: approved and implemented in the working tree. The migration is applied to disposable local Supabase only. See `docs/account-funds.md` for setup and current behavior. Optional opening setup is available through Manage funds after account creation.

## Intended behavior

Enter a trading decision once, select its destination accounts with checkboxes, and save an independent trade record to each selected account. Track each account's opening balance, deposits, withdrawals, and corrections separately from trading profit.

Preserve the compact journal header and existing broker, account ID, nickname, server, and currency labels. This extends the account implementation already in the working tree; CSV/Notion import remains a separate increment.

## 1. Selecting multiple accounts

- At the top of Capture the trade, add a compact Log to accounts fieldset with labeled checkboxes. Each row shows nickname, broker, account ID, server when needed to distinguish identities, and currency. Large lists can be searched.
- Preselect the currently viewed individual account. From All accounts, require an explicit selection. At least one eligible account is required. Do not silently include every account or remember additional destinations for a new draft.
- Reporting scope remains separate: these checkboxes control this save only. Selecting another destination does not switch History, Analytics, or Weekly Review.
- Selected destinations belong to the current draft. Deselecting an account preserves its unsaved values until that draft is saved or discarded. Existing per-account draft behavior must survive switching journal scope. Clear drafts on logout or user change.
- Show a selection count and an exact action label, such as Save to 2 accounts. During saving, disable duplicate submission. Success names both destinations; validation errors identify the affected account and retain the draft.
- Use native checkboxes and visible labels, keyboard navigation, at least 44px row targets, announced selection/save feedback, and a stacked mobile layout.

## 2. Shared trade, separate results

Shared defaults: symbol, direction, execution/opening date and time, setup tags, notes, and initial entry price. Use one common default timestamp for simultaneous entries, with an optional per-account execution-time override.

Reveal account-specific details only after selection: entry override, exit price, status/result, closing date/time, and net realized P&L in that account's currency. A Use shared entry toggle keeps simple entries quick. Position sizing and automatic contract-value P&L calculation are deferred; never infer money P&L from price change alone.

Example: the same XAUUSD long can close at +100 USD on a personal account and +250 USD on a funded account. Different fills or exits can produce different outcomes, so closing/editing one account's trade must not alter the other.

- Open trades have no realized P&L or closing time. Closed trades need a closing time; missing money can be explicitly marked unknown, preserving journal use while marking balance coverage incomplete.
- A supplied net P&L is after trading fees. Derive result from its sign where appropriate; conflicting supplied results require correction. Existing price-return percentage stays separate from account return.
- Save one trade row per selected account, linked by a new trade_group_id for this original decision. Independent later edits are the default. Bulk closing/editing is deferred; no hidden propagation.
- All accounts History shows the account on every row and a shared-entry indicator. Report trade statistics as account trade records; when displaying decision counts, use distinct groups. For example: 2 account trades, 1 shared entry. Legacy ungrouped records count as individual decisions without guessing historical links.
- Never sum account return percentages or present mixed currencies as one money total. Keep balance and cash summaries per account.

First release: manual accounts only for checkbox saving. MT5-linked accounts show an explanatory disabled state because those trades are already imported automatically. Supporting manual copies into synced accounts requires broker-ticket reconciliation first; resemblance alone is not sufficient deduplication.

## 3. Managing account money

Add Manage funds to the selected account and account management. A compact summary shows currency, opening balance/date, net deposits, net realized trading P&L, recorded balance, and data coverage. Accounts without setup show Set opening balance rather than zero.

Opening setup asks for a balance and an as-of date/time, with the account timezone visible. Explain that this is a snapshot already including all activity through that instant. Users with full history can choose their true starting balance before the first trade. Existing accounts are not assigned invented balances.

| Action | User enters | Effect |
| --- | --- | --- |
| Deposit | Positive amount, effective date/time, optional note | Adds funds; excluded from trading profit |
| Withdrawal | Positive amount, effective date/time, optional note | Removes funds; excluded from trading loss |
| Adjustment | Increase/decrease, positive amount, effective date/time, required reason | Corrects recorded funds; excluded from trading profit |
| Standalone fee | Positive amount, effective date/time, note | Removes funds; reported separately from trade results |
| Edit / void | Corrected values or void reason | Replaces or reverses the original effect with visible history |

The Add account dialog may offer optional opening balance/date setup; users can skip it and configure it later. Currency must be known before recording funds and cannot change after monetary activity exists.

Do not expose an unexplained overwritable current-balance field. To correct a mistaken deposit, edit that entry. To reconcile a genuine unexplained difference, use an adjustment with a reason. Show original and corrected values, who changed them, and when. Voiding an entry keeps its history and removes its effect once. These operations never delete trades.

Funds affect one explicitly named account per action. Deposit/withdrawal inputs use positive amounts; the server determines their sign. Allow a negative resulting recorded balance with a clear preview, since this is a journal of actual activity rather than a payment authorization system.

## 4. Balance rules

Recorded balance = opening snapshot + subsequent deposits - subsequent withdrawals + signed adjustments - standalone fees + subsequent net realized trade P&L.

- Include only effective cash entries and trade realizations strictly after the opening snapshot and through the requested report time. Show the exact boundary to avoid counting activity already included in the snapshot. Cash entries at or before it require a different opening boundary or a correction of the snapshot, rather than silently affecting the total.
- Closed trades affect balance by closing time, not journal entry time. Historical closed trades missing a trustworthy closing time or net P&L are flagged for correction; no fabricated dates or zero values.
- Unknown cash P&L, unresolved relevant dates, or incomplete sync coverage yields Known recorded balance with an incomplete-coverage message. Display the missing-record count where determinable. This is not live broker equity and excludes floating open-trade P&L and broker credit/margin.
- MT5 trade P&L already includes commission and swap. Never subtract them again as standalone fees. Manual net P&L follows the same convention.
- For synced accounts, initial funds tracking can be manual with an explicit Manual funds history label. Do not imply broker cash movements are automatically synchronized or complete. Reconciliation/import of broker cash events is deferred.
- Changing a trade's net P&L, closing time, or open/closed status recalculates the affected account once, with a revision trail. Older unknown values remain unknown until supplied.
- Store decimal money exactly and use currency-aware precision, including supported crypto currencies; avoid binary floating-point accumulation. Amounts must be within explicit supported bounds. API money values use decimal strings.
- The funding panel is scoped to individual accounts. All accounts shows per-account summaries; combined cash totals and FX conversion are deferred.

Example: opening 1,000 USD + deposit 500 - withdrawal 100 + net trade profit 80 = recorded balance 1,480 USD. Trading profit is 80 USD, not 480 USD.

## 5. Implementation proposal

1. Add nullable trade_group_id to trades with an owner-consistent group reference; add journal_trade_groups with user ownership and request/idempotency identity. Old single-account saves continue working. Existing rows do not gain inferred groups.
2. Add a separate POST /api/journal/trade-batches accepting shared fields plus per-account overrides. Validate unique, eligible, owned destination IDs, supported currencies, trade fields, dates, and configured batch limits. Preserve the existing single-trade API and MT5 path.
3. Create the group and every destination trade in one database transaction. Any invalid destination or write failure saves nothing. A user-scoped idempotency key returns the original result on retry; reusing it for different content is rejected. Do not fan out independent HTTP writes.
4. Add opening-snapshot storage and journal_account_cash_entries with owner/account references, kind, decimal amount, currency, effective time, note/reason, creation metadata, and revision/void references. Only one effective opening snapshot per account; preserve previous versions.
5. Add account-scoped funds read/create/edit/void endpoints. Opening setup and corrections, cash changes, and audit revisions are transactional and idempotent. Use version checks so concurrent edits cannot silently overwrite each other.
6. Compute summaries from effective ledger records plus existing eligible trade P&L; do not maintain a second independent running total or duplicate trade P&L into editable cash entries. Keep relevant trade monetary/status/date revisions auditable too.
7. Enforce ownership in APIs and database composite constraints. Follow the current server-only database model; no new direct browser database grants. Ensure balance-affecting changes invalidate account summaries.
8. Build the compact checkbox area, progressive per-account execution fields, exact save feedback, funds dialog, and transaction history. Extend history edit/close flows for net money and closing dates, retaining existing draft isolation.

## 6. Suggested delivery order

1. Checkbox trade logging, atomic batch persistence, linked rows, and independent edits/results.
2. Opening balances and auditable deposits, withdrawals, corrections, and fee history.
3. Derived recorded balances, coverage indicators, and report/history integration.

Evaluate locally after each increment. Test additive migrations on disposable Supabase before any hosted migration. This proposal does not authorize deployment, hosted database changes, or CSV/Notion import work.

## 7. Acceptance checks

- Selecting two accounts creates exactly two linked records; a one-account save still works. No selection cannot submit.
- Different net results and execution dates remain account-specific; editing or deleting one record does not mutate its sibling.
- A failed second destination leaves neither trade saved. Double click, timeout retry, and concurrent identical requests never duplicate the group.
- Another user's account ID, a duplicate destination, or a now-ineligible account is rejected without partial saves. Account selection and drafts clear when the signed-in user changes.
- Checkbox state does not change reporting scope. Mobile layout, keyboard operation, dialog focus, and announced feedback work.
- Deposit, withdrawal, signed adjustment, fee, edit, void, and opening correction produce exact expected balances and preserve their history. Retry and concurrent edit behavior are covered.
- Funding does not alter win rate, trade count, or trading profit. Mixed currencies remain separate, and crypto precision is preserved.
- Missing P&L/dates show incomplete coverage. Pre-snapshot trades/cash are not counted twice. Trade edits, closure, reopening, and deletion update the derived balance appropriately.
- MT5 commission/swap is counted once; manual copies to synced accounts are unavailable until reconciliation exists.

## Review defaults

Recommended first version: manual-account checkbox logging, independent per-account net results, one-account-at-a-time funds actions, audited corrections, optional opening setup, and explicit balance coverage. Automated broker cash sync, bulk closing, transfers, FX conversion, position-size calculations, and Notion import are later increments.
