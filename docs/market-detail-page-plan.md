# Market detail page and heat ladder

Status: implemented and validated on `feature/market-card-redesign`. Approved plan retained below; delivery notes follow it.

## Outcome

Ship the existing heat ladder redesign and a dedicated market analysis page as one commit. The ladder compares markets; the popup gives a quick read; the page explains one market in depth.

Audience: traders checking the evidence behind MacroFlow's fundamental bias. Direction: a quiet, utilitarian research screen using the existing dark canvas, forest green `#1e3b2f`, deep red `#831613`, and existing fonts. Use lighter existing tokens for readable directional text and chart lines.

## Navigation

- Keep row click opening the current popup.
- Add a visible **Open full analysis** link near the popup heading, using a real link to `/markets/XAUUSD` or the matching supported symbol.
- Open in the same tab by default; normal browser link actions support a new tab.
- Support direct URLs, refresh, browser back, and switching among all five markets: XAUUSD, GBPUSD, US100, DJ30, BTCUSD.
- Provide an explicit **Back to markets** link. Preserve the dashboard filter and ladder position on the normal round trip, and give direct arrivals a working dashboard destination.
- Validate the route against a shared lightweight symbol registry. Unknown symbols get a helpful 404 with a dashboard link; they must not fall through to the API's all-market response.

## Page, in reading order

### 1. Market identity and current read

Compact back navigation and market switcher, then symbol and full name. One prominent signed bias percentage, direction written in words, conviction, open/closed status, and update time. Include a short explanation that this is MacroFlow's normalized bias measure, not price performance or a probability.

A short factual summary uses the existing score and scored events. Show source mode and stale/degraded status close to the summary. Keep the existing reference-chart link with its instrument note, including the cash-index versus broker-CFD distinction for US100 and DJ30.

### 2. Why this bias

This is the main reading area. Present supporting and opposing drivers in clearly labelled groups, ordered by absolute rule contribution, with zero-contribution events identified separately when present. Explain each with its headline, description, impact, signed contribution, and available source/article link. Use readable rows with expandable descriptions rather than a grid of small cards. Show both sides even when one side has no drivers.

Label contributions as rule inputs: category caps and engine transformations mean individual contributions need not sum to the final score. Do not describe high-impact or high-conviction events as technical confirmation. Avoid adding an inferred fear/greed gauge.

### 3. Bias history

Show the available seven daily snapshots as a simple line chart with a fixed -100 to +100 scale and a visible zero line. Label it **Bias history**, with dates and a matching accessible table. Preserve missing days as gaps; a single point or no history gets an explicit state. No fabricated candles or price history.

### 4. Upcoming releases

Reuse the economic calendar with an optional symbol filter applied through `event.affects`, including its next-release summary. Retain local timezone labels, official source links, coverage notes, retry, and freshness states. Retain dashboard behavior when no symbol is supplied. Explain when no relevant upcoming releases exist within the feed window. Calendar items remain context and do not change bias scores.

### 5. Broader macro context

Reuse existing Treasury yield and spread observations, their sources, observation dates, daily-data labels, and expiry handling. These readings are broader context rather than extra score inputs. Include the existing DXY context only when supplied, using factual observation wording. Missing observations remain unavailable.

### 6. How to read the score

Use a compact expandable explanation of the normalized percentage, raw score range, conviction, agreement, and signal coverage, verified against the engine. Preserve access to the signal, strength, event counts, bullish/bearish counts, high-impact count, raw score, agreement and coverage currently available in the popup. Keep the existing disclaimer unchanged.

## Composition and interactions

- Desktop: capped content width; wide evidence column and a narrower summary/history area, then calendar and macro sections below. Use whitespace and dividers rather than nested cards. Keep DOM reading order coherent when the layout stacks.
- Phone: one column, current read first, then drivers, history, releases and context. Wrap the five-market switcher; local table scrolling must not cause page overflow.
- Use one compact set of section anchor links if the implemented page length warrants it. Do not add a tab system that conceals the research content.
- Reuse white primary actions and existing direction tokens. Sentence-case labels, no decorative gradients, small badges, or redundant score meters.
- Retain visible focus, native links/buttons, meaningful headings, skip-link target, textual direction and signs, chart table alternative, and reduced-motion behavior. Popup close and Escape restore focus to its row; navigation must release the popup's scroll lock.

## Data and states

- Fetch the selected market through the existing `/api/bias?symbol=...` endpoint. Preserve `source`, `sourceHealth`, `stale`, `timestamp`, `dxy`, and disclaimer metadata around the selected result.
- Use the existing resource-loading pattern with the dashboard's 15-minute bias cadence, manual retry, timeout/cancellation, and hidden-tab suppression. Abort or discard old requests when changing symbols so an earlier response cannot overwrite the new market.
- Share small presentation/formatting helpers between popup and page where they prevent inconsistent readings. Keep the existing popup and its content available.
- Loading: a layout-matched skeleton on the initial request. Refresh: retain the last successful read and its timestamp. Failed refresh: inline error and retry, marking retained data as outdated. Missing selected result: explicit unavailable state rather than silently showing another market.
- Calendar and macro failures remain independent of bias and drivers. Honor existing feature flags and provider freshness/expiry behavior.
- Use existing providers and dependencies. Price-chart embedding, longer history, alerts, and additional feeds can be assessed separately after this version.

## Proposed file changes

New:

- `src/app/markets/[symbol]/page.tsx`: validated route and per-market metadata.
- `src/app/markets/[symbol]/not-found.tsx`: unsupported-market destination.
- `src/components/market/MarketDetailPage.tsx`: data lifecycle and page composition.
- `src/components/market/MarketAnalysis.tsx`: shared evidence/history/readout primitives where reuse is useful.
- `src/lib/market/symbols.ts`: lightweight symbol registry for route and UI validation, avoiding a client import of the scoring engine.
- Focused page browser coverage and any necessary pure-helper tests.

Edit:

- `src/components/BiasDetail.tsx`: full-page link, shared formatting where appropriate; preserve quick-read content and dismissal behavior.
- `src/components/market/EconomicCalendar.tsx`: optional symbol scope applied to events and next-release summary.
- `src/app/page.tsx`: filter/return-state handling if needed for the dashboard round trip.
- `src/app/globals.css`: page layout, chart and interaction styles using existing tokens.
- `tests/e2e/ui.spec.ts` and/or a dedicated market-page spec: deterministic navigation, data and responsive coverage.

The existing uncommitted redesign also touches `MarketCard.tsx`, `ConnectAccount.tsx`, `LogTradeForm.tsx`, and `TradeHistory.tsx`; include those intentional changes in the same commit. No route or component deletion is planned.

## Verification and delivery

1. Confirm the existing redesign diff and branch before implementing. Both `feature/market-card-redesign` and the currently checked-out `feature/market-context-integration` point to `d48f377`; move the working changes onto the redesign branch without losing them.
2. Build the page and popup link together, then verify all five markets using deterministic fixtures. Cover direct entry, unknown symbol, switch during a slow request, browser back, dashboard return state, and popup scroll-lock cleanup.
3. Exercise bullish, bearish, neutral, no drivers/history, one history point, stale/baseline data, bias failure, and independent calendar/macro failures. Verify symbol filtering also controls the next-release summary.
4. Run TypeScript, ESLint, unit tests, and the relevant Playwright suite with accessibility scans at desktop, tablet and phone widths. Check keyboard use, contrast, zoom/reflow, and chart/table agreement.
5. Run a production build with a separate output directory if the active dev server needs to remain running. Verify the production route, not only development rendering.
6. Run the installed Hallmark checker in app scope before and after the new work. Review new-page findings, preserve the established palette, and document any existing global findings separately. Report actual counts and unresolved findings; do not call the whole app clean from a scoped result.
7. Review the final diff, explicitly stage the intended source/tests/plan, and create one commit containing the heat ladder redesign plus market pages. Exclude `.hallmark/`, screenshots and generated artifacts. Suggested message: `feat: redesign market overview and add detailed market pages`.

The existing market-context commit `d48f377` remains the base. The new combined commit is reviewable and revertible as one unit.

## Delivery notes (2026-11-09)

Implemented all five `/markets/[symbol]` pages, the popup link, saved overview filter/scroll position, source and stale-state presentation, driver groups, fixed-scale daily history, score methodology, symbol-scoped calendar, and existing macro/reference links. The popup also corrects its previous claim of technical confirmation and identifies agreement as an overall event-direction measure.

The page reuses the existing resource hook, panels, tokens and providers. Shared direction and signed-number formatters keep the popup/page terminology consistent. `MarketAnalysis.tsx` contains the driver, history and methodology sections rather than duplicating the entire popup layout. No dependencies or providers were added.

Validation completed:

- `npm test`: 226 unit tests passed.
- `npm run test:ui`: 25 browser tests passed (12 existing overview/account tests and 13 new market-page tests).
- The 13 market-page tests also passed against `next start` on port 3100 after an isolated production build.
- Axe scans passed at 1440px, 768px and 375px. Phone text enlargement, keyboard driver expansion, dialog dismissal/focus restoration, overflow, and reduced motion were checked.
- `npm run lint -- src tests next.config.ts playwright.ui.config.ts`: no errors; one existing unused-helper warning in `src/lib/__tests__/engine.test.ts`.
- Unscoped `npm run lint` still fails on existing generated `.superpowers` files and an existing script lint error; it is not a clean repository-wide check.
- Production build passed, including TypeScript. `MACROFLOW_BUILD_DIR=.artifacts/market-build` isolates output from the developer server; `MACROFLOW_UI_BASE_URL=http://localhost:3100` runs the UI suite against that output. The build's generated tsconfig include additions were removed from the source diff.
- Hallmark app-scope production audit: **42 FAIL, 103 REFLEX, 10 WARN** across five source files and the new route. All FAIL/REFLEX findings are in pre-existing global stylesheet rules outside the new research styles. There are no static findings in the new route/components and no findings from the production page render. This is a scoped audit, not a clean-app claim. The initial four-file overview baseline was 47 FAIL, 105 REFLEX, 13 WARN; its input scope differs, so those totals are not a direct score comparison.
- New-page warning review: the two side rules identify bias direction/error state; the 40ch summary is a short read rather than body prose. Both are intentional. The final production render confirms calendar field borders now use the readable muted token. Other warnings and Reflex findings concern existing global styles; none are presented as waived or resolved.
- Visual review performed in-thread on the actual production page and rendered phone layout. The new page uses evidence rows, not nested metric cards; its narrow-screen research flow stays linear and its chart identifies bias rather than price. No independent subagent review was run.

Local screenshots and raw audit results remain under `.artifacts/` and `.hallmark/`, outside the commit. Market hours retain the existing weekday/holiday approximation and the calendar retains its selected-agency coverage. No new price data or longer historical series is implied.
