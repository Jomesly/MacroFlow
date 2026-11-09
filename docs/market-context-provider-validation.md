# Market context provider validation

Updated locally 2026-11-09, Asia/Manila. Phase 0 remains **incomplete**. Public dashboard first, paid journal later; free display does not establish redistribution rights.

## Current source decisions and evidence

| Feature | Implemented source | Local result | Hosted status |
| --- | --- | --- | --- |
| US release dates | BLS official ICS | HTTP 200; selected CPI/jobs/PPI/JOLTS/cost/productivity releases normalized, NY daylight saving respected | Pending Vercel access |
| US GDP/PCE/trade dates | BEA official ICS | HTTP 200; folded/escaped ICS titles handled | Pending |
| UK release dates | ONS search/releases API | HTTP 200; explicit `release-type=type-upcoming`; confirmed, not cancelled/postponed, no duplicate time-series publications | Pending |
| 2Y/10Y Treasury | Direct Treasury annual CSV | HTTP 200; Nov 6 observations 4.51% / 4.86%; spread 35 bps | Pending |
| New DXY/VIX context | Disabled | No Yahoo/FRED requests; null compatibility slots in API, no cards rendered | Not enabled |
| Price charts | External TradingView reference pages | All five markets mapped as reference links; no data fetched or republished | No embedded charts |

`node scripts/validate-market-context.mjs` passed locally with all three agencies fresh and 13 selected events. The calendar combines a four-week UTC window with ONS upcoming releases, rather than claiming comprehensive global coverage. Partial agency outages remain visible. Unknown release times are excluded; no placeholder times, consensus forecasts, previous values, or actuals are generated.

Treasury reads both tenors from one snapshot; blank cells are not zero, future rows are ignored, and spread dates must match. At the start of January, the previous year's final observations may be used within the seven-day observation limit. Daily closes are labelled delayed.

## Reuse and attribution

- [BLS copyright information](https://www.bls.gov/opub/copyright-information.htm) describes its publications as public domain, with exceptions for previously copyrighted images. [Official iCalendar instructions](https://www.bls.gov/help/hlpiCAL.htm) identify the publication feed used here.
- [BEA reuse FAQ](https://www.bea.gov/help/faq/147) permits reuse of its website information unless stated otherwise. The UI cites BEA and links its [schedule](https://www.bea.gov/news/schedule).
- [ONS terms](https://www.ons.gov.uk/help/terms-conditions) generally license website content under the Open Government Licence, with exceptions. The UI cites ONS and links OGL v3.0. Release metadata is retrieved through its [documented API](https://developer.ons.gov.uk/search/search-releases/).
- [Treasury daily rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve) are retrieved directly and attributed to the U.S. Department of the Treasury. No third-party branded rate feed or Treasury imagery is copied. The [U.S. Copyright Office](https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf) describes the general rule for U.S. government works; this does not clear other providers.
- Forex Factory is no longer requested by the new calendar adapter. Its [notices](https://www.forexfactory.com/notices) restrict calendar republication without consent; direct retrieval returned 403 during review.
- New DXY/VIX adapters were removed, rather than assuming Yahoo endpoint access or FRED availability establishes public-display rights. Existing scored sources remain unchanged and need a separate source/use audit before declaring the whole dashboard cleared.

## TradingView evaluation

The [Advanced Chart widget](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) is documented as free to embed. Its [data FAQ](https://www.tradingview.com/widget-docs/faq/data/) explains symbol-specific restrictions, no downloadable data, and that personal subscriptions do not upgrade widgets. Its [general FAQ](https://www.tradingview.com/widget-docs/faq/general/) requires keeping attribution or arranging changes with TradingView. The broader [terms](https://www.tradingview.com/policies/) restrict commercial use absent express permission and competing services. Therefore MacroFlow's exact public/commercial use still needs confirmation; no vendor has been contacted.

| MacroFlow market | Candidate widget identifier | Identity and unresolved requirement |
| --- | --- | --- |
| XAUUSD | OANDA:XAUUSD | Gold/USD reference; confirm product class and eligible spot/history, distinct from gold futures/ETF |
| GBPUSD | FX:GBPUSD | FXCM reference; validate embedded symbol and every intended range |
| US100 | NASDAQ:NDX | Cash index reference, not broker US100; index entitlement is not established by NASDAQ stock coverage |
| DJ30 | DJ:DJI | Cash index reference, not broker DJ30; exact widget entitlement pending |
| BTCUSD | BITSTAMP:BTCUSD | Direct USD spot pair, not USDT; exact widget/range proof pending |

[Worldwide widget markets](https://www.tradingview.com/widget-docs/markets/worldwide/) include FXCM/OANDA and crypto providers. [North America coverage](https://www.tradingview.com/widget-docs/markets/north-america/) does not establish every NASDAQ/Dow index's eligibility. Reference-page links do not claim embed approval. There is no custom chart library or price API in this increment.

## Hosted validation blocker

The workspace is linked to Vercel project `macro-flow`, project `prj_pg4nR8POkOHkqNPn1PS9sIUSLero`, team `team_EGuuu1SPZcMyddtN7X9KYHnD`. The connector returned 403: missing authorization for `jomeslys-projects`. It explicitly requests team authorization before retrying. No deployment was created.

Preview provider caches are isolated by preview hostname; production and local provider caches have separate scopes. A fresh preview is required to demonstrate provider access from the host. The smoke script supports a protection-bypass secret through an environment variable without printing it.

## Journal increment and rollout

- Weekly review uses Monday to Sunday UTC closing dates, includes positions opened earlier, preserves missing-money coverage, and suppresses combined money across accounts. Existing session labels describe NY evening versus outside NY evening; they are not redefined as London/Tokyo sessions.
- Trade pagination reads beyond the PostgREST response cap, with owner filtering on every page.
- Private screenshots require `supabase/journal-screenshots.sql` and `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED=true`. The flag defaults off. A restrictive Storage policy prevents direct browser access even alongside broad permissive policies. Server routes require journal permission and trade ownership on every read/upload/delete, cap body/image sizes, check image signatures, use fixed slots without overwrite, and stream images with `private, no-store`.
- Trade deletion removes screenshots before deleting the row; upload rechecks ownership to clean up a concurrent trade deletion. Administrators removing accounts or database rows outside the application must also remove their private Storage objects.
- No hosted schema, bucket, billing entitlement, or subscription has been changed. The journal remains free beta; MT5 and current authorization behavior remain in place.

## Validation record

Local live smoke: all three agencies fresh, 13 selected releases, direct Treasury matched-date spread; no new DXY/VIX values. Final unit suite: **226 passing tests across 26 files**. Dashboard UI suite: **12 passing checks**, including desktop/tablet/mobile, keyboard use, enlarged text, reduced motion, outages, and automated accessibility. Final production build (including TypeScript), scoped ESLint, and `git diff --check` passed.

Isolated Supabase/Auth/Storage integration suite: **8 passed, 2 skipped**. The skipped checks require the optional Turnstile test mode. Passing checks cover signup, confirmation, recovery, account isolation and switching, MT5 access, responsive journal workspace, concurrent session refresh through token expiry, weekly review, private screenshots, and deletion cleanup. Weekly review screenshots were also visually inspected at 1440px and 375px. These checks used a disposable local project; they do not establish hosted provider availability or hosted Storage configuration.

A final fresh-database targeted rerun passed the weekly review/screenshot test with direct Storage denial for both anonymous and authenticated clients, four concurrent uploads competing for two free slots (two created, two rejected), other-user denial, and object cleanup after trade deletion. The runner now tolerates PostgreSQL's harmless first-run `DROP POLICY IF EXISTS` notice while still checking the migration exit code.
