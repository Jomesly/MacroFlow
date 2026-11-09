# MacroFlow public launch and journal integration

Updated: 2026-11-09. Branch: `feature/market-context-integration`.

## Accepted direction

MacroFlow remains the application. Adopt selected OpenTerminal ideas, with no backend replacement or history merge. Launch a focused public dashboard; keep the journal in free beta initially and introduce a paid journal offering later. No OpenTerminal source files have been copied.

This revision supersedes the original full-terminal first-release scope. The owner approved execution of the lean-launch recommendation on 2026-11-09.

## Current implementation

1. Reliability foundation: validated resource schemas, bounded stale retention, Redis refresh leases, request coalescing, cooldowns, timeouts, and independent panel recovery. New resources separate local, production, and individual preview caches.
2. Official economic calendar: selected BLS/BEA US releases and confirmed upcoming ONS UK releases. A Monday-based four-week window, local release times, source links, agency status, and USD/GBP filters. MacroFlow assigns editorial priorities; agencies do not supply these ratings. No consensus, previous or actual figures are fabricated. This is a deliberately limited schedule, including no FOMC/BoE meetings, speeches, or Census releases.
3. Macro context: direct U.S. Treasury 2Y/10Y par yields and a matched-date spread. Daily observation dates remain visible. No new DXY/VIX requests. Existing scored providers and scoring rules remain unchanged and still require their own public-use audit.
4. Chart evaluation: TradingView's official widget documentation and market lists reviewed. Public reference-chart links for all five markets are available inside analysis. Nasdaq/Dow references explicitly describe the cash-index versus broker-CFD distinction. Widgets are not embedded; exact symbol availability, all ranges, and commercial-use terms remain unresolved.
5. Journal improvements: a weekly review tab with UTC closing-week results, account filters, notes coverage, and setup/session breakdowns. Monetary results are suppressed across multiple accounts. Trade listing paginates beyond PostgREST's single-response cap. Existing MT5 sync and journal editing are retained.
6. Private screenshots: up to three PNG/JPEG/WebP images per trade, at most 3 MB each, with owner checks on every upload/read/delete and no public image URLs. Feature defaults off until the private bucket migration is applied and tested in the target environment.

## Phase status

| Phase | State |
| --- | --- |
| 0: provider proof and release prerequisites | Incomplete: official feeds pass locally; hosted Vercel access and chart rights/coverage remain pending. Existing provider public-use audit also remains pending. |
| 1: reliability | Implemented and locally tested. |
| 2: calendar and macro context | Official-source replacement implemented; hosted validation pending. |
| 3: charts and headlines | External chart references implemented; embeds/custom charts and headline expansion deferred until provider gates pass. |
| Journal review increment | Implemented; isolated integration validation recorded in the provider report. |
| 4: command palette and preferences | Deferred backlog, outside the accepted lean-launch increment. |

The earlier phases 1 and 2 implementation happened before Phase 0 was complete. Neither that work nor this revision makes Phase 0 complete.

## Release sequence

1. Pass local unit, TypeScript, lint, build, dashboard accessibility, and isolated journal/MT5 integration checks.
2. Restore access to the linked Vercel team and create a preview of this branch. The existing public-use status of scored providers must be resolved before a public production launch.
3. Run `node scripts/validate-market-context.mjs https://<preview-host>` against a fresh preview. It checks all agencies, observations, matching spread dates, and absence of new DXY/VIX data. Preview-specific cache keys prevent local caches from being mistaken for hosted proof.
4. Apply `supabase/journal-screenshots.sql` to the preview database. Validate own-user access, other-user denial, direct Storage denial, upload limits, and deletion cleanup. Only then set `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED=true` and rebuild there.
5. Record preview evidence before any production promotion. No hosted migration, subscription, vendor contact, push, merge, or production deployment has been performed.

## Paid journal follow-up

The journal stays free beta in this increment. Billing needs a separate concrete product decision: paid feature boundaries, pricing, provider, cancellation/grace behavior, and access migration for existing users. Existing server-controlled `journal_access` remains the authorization boundary; do not derive entitlements from client flags. Continue validating MT5 replay/idempotency and preserve user annotations during re-sync.

## Deferred feeds

Custom price history, TradingView embedding, consensus forecasts, VIX, DXY display feeds, and additional news require source-specific rights and coverage. Do not substitute GLD, futures, QQQ/DIA, or BTC/USDT for missing requested instruments. Widget data must never enter the scoring engine or be extracted as an API.

See [provider validation](market-context-provider-validation.md) for evidence, source terms, remaining blockers, and validation results.
