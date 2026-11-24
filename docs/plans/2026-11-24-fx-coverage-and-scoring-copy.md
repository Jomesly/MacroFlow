# FX evidence coverage and current scoring explanations

Status: implemented and tested locally, 2026-11-24. Nothing pushed or deployed.

Implementation uses 14 verified FRED/ALFRED series across all seven counterpart economies; see [the source registry and provenance rules](../international-macro.md). Both configured series must be usable for each country's health check. Domestic release surprises remain conditional future work: this implementation adds verified trends and preserves the separate US actual/consensus path.

Validation: all 1,121 unit/integration tests, TypeScript, lint and both application builds passed. Desktop/phone market browser tests passed; the current forecast page also passed accessibility scans at 1440px and 375px with no horizontal overflow. The read-only source checker passed all 14 series, and the local API confirmed US plus counterpart structured coverage for every FX pair. Actual calls still depend on the existing grade checks. All work remains local.

## Outcome

Allow each FX pair to qualify for a call when genuine evidence from both economies and the existing signal checks support it. Explain the current four-hour model consistently in MacroFlow and the portfolio. New coverage makes qualification possible; it does not guarantee calls.

## Confirmed starting point

- `src/lib/macro-coverage.ts` requires US evidence and counterpart evidence for every FX pair. Both economies' net contributions must support the pair's direction.
- `src/lib/macro-context.ts` supplies US economic trends. `src/lib/calendar/index.ts`, `us-actuals.ts` and `surprises.ts` supply US actuals and surprises. The calendar already lists foreign releases, but their schedules do not supply verified economic actuals.
- `src/lib/signal-grade.ts` requires country coverage in the mandatory macro check. `src/lib/bias-snapshot.ts` derives the public conviction and call from that grade. Current adapters therefore leave all seven FX pairs at Low conviction with no call.
- `src/lib/forecast.ts` uses a four-hour horizon and 70% news / 30% macro when both components exist. A sole component gets full weight. Asset price action is excluded from the score.
- The portfolio's `content/profile.ts`, under “See what drives the score”, describes the older rule-capacity denominator. MacroFlow's current README scoring section also uses that model. `MarketAnalysis.tsx` explains internal forecast conviction instead of the public seven-check grade.

Use `forecast.ts`, `signal-grade.ts`, `bias-snapshot.ts` and `docs/news-forecast.md` as the current reference. Historical research reports retain their original dated findings.

## 1. Correct the explanations first

In the separate Portfolio repository, replace the paragraph in `content/profile.ts` with:

> MacroFlow builds a four-hour market bias from recent news and economic data, weighted 70% and 30% when both are available. Seven checks decide whether the evidence qualifies for a buy or sell call. The percentage shows directional strength, not a win probability. Traders confirm the bias with their own charts.

Add this short current limitation to “A working beta with clear limits”:

> Currency-pair calls need economic data from both economies. Counterpart data is not connected yet.

Update the adjacent “next” copy to describe international economic coverage and collecting results with the existing signal recorder. Verify scheduling status separately before describing collection as running. The next step must not imply that the recorder has yet to be built.

Update MacroFlow's README and `src/components/market/MarketAnalysis.tsx` to match the public grading rules. Keep the main explanation brief and put thresholds in the existing methodology details:

- A directional score needs magnitude at least 30 before it can qualify.
- High conviction: all seven checks pass.
- Medium conviction: the five mandatory checks pass, with exactly one of the two confirming checks missing: supporting news-source breadth or dollar/yield confirmation.
- Otherwise: Low conviction, with no buy/sell call. Any six checks are not automatically sufficient.
- The checks cover fresh supporting news, matching structured macro evidence, supporting sources, at least 70% weighted evidence agreement, dollar/yield confirmation, a verified calendar clear of high-impact events through four hours, and healthy inputs.
- Conviction and directional strength do not establish a measured success probability. Preserve the existing separate outcome-based claim gate.

Validate copy with each repository's local build/lint checks and local page rendering; no new tests are needed merely to repeat paragraph text.

## 2. Define and verify country data sources

Start with GBP/USD, which already has UK scoring rules and partial release classification. Then extend the adapter pattern to all other counterpart economies:

| Pair | Required structured economies |
| --- | --- |
| GBP/USD | US + United Kingdom |
| EUR/USD | US + euro area |
| USD/JPY | US + Japan |
| USD/CHF | US + Switzerland |
| AUD/USD | US + Australia |
| USD/CAD | US + Canada |
| NZD/USD | US + New Zealand |

For each economy, select and verify an explicit indicator set, initially economic trends such as inflation, employment and growth where supported. Record the actual series identifiers, units, frequency, transformation, revision policy and directional interpretation before implementation. Do not assume the existing US transforms or thresholds transfer unchanged.

Prefer official statistical or central-bank sources where their data meets the contract. Candidate interfaces include [ONS datasets](https://developer.ons.gov.uk/), [ECB SDMX](https://data.ecb.europa.eu/help/api/overview), and [Bank of Canada Valet](https://www.bankofcanada.ca/valet/docs/). These document available interfaces; suitable series, publication provenance and runtime reliability still need verification. Other economies need the same source investigation. Do not select a provider based only on the presence of a current value.

Use a common normalized observation/snapshot contract with country, indicator and series, value and units, observation period, publication/availability time, vintage or revision identifier where available, fetched time, expiry and source URL. Keep observation time, availability time and fetch time distinct.

The current model expires trend snapshots after 48 hours and surprises after 24 hours. Define how a current, verified snapshot of monthly/quarterly observations is obtained and bounded by underlying observation age. Polling a source must not turn an old release into a new event. Unknown publication timing cannot become retrospectively available evidence.

Verified trends can support the first release of coverage. Add surprise scoring only where actual values and comparable consensus archived before release are available. A forecast or previous value is not an actual; a trend change is not a consensus surprise.

Deliverable: an explicit source/series matrix, normalized example payloads and freshness rules for the pilot, followed by the remaining economies. Source suitability is a dependency for implementation estimates.

## 3. Implement the UK pilot through the complete scoring path

- Introduce a shared country-adapter interface and a UK implementation, using the existing US path as a compatibility reference. Emit validated structured events into `src/lib/api/index.ts` and the normal as-of selection path.
- Preserve the US context/regime calculation. Keep country metadata through caching, deduplication, scoring, factor display and coverage assessment.
- Review country-specific scoring rules against normalized units and indicator meaning. Verify both quote orientations; domestic contributions already expressed in pair direction must not be inverted again.
- Make required domestic provider health specific to the affected pair. Today `signal-inputs.ts` treats any provider failure as a global pause. Define provider dependencies per market before adding domestic feeds; preserve shared-provider failure behavior and keep unknown/missing required health blocking the dependent pair.
- In the existing market-detail explanation, show a short reason such as “Waiting for UK economic data” when coverage blocks a call. Keep full source diagnostics in the existing details, without adding more information to the market cards.
- Keep the score floor, country-support requirement and other grade checks unchanged. Conflicting or insufficient evidence continues to block calls.

Deliverable: GBP/USD can qualify in valid fixtures and local read-only data checks, with traceable inputs and clear reasons when it cannot qualify.

## 4. Extend coverage and verify releases

Apply the pilot pattern to the euro area, Japan, Switzerland, Australia, Canada and New Zealand. Mark each pair covered only after its own source and integration checks pass.

When verified actuals/consensus support surprise scoring, generalize the USD-only `calendar/surprises.ts` path and the US/GB-only country filter in `api/calendar.ts`. Map currencies to economies explicitly, verify release classification and units, and preserve pre-release consensus provenance. Merely listing a currency in the calendar cannot satisfy country coverage.

Version changed model/input behavior using a new `FORECAST_VERSION`, plus affected input caches. Preserve old outcomes and allow existing signals to resolve; current-version statistics must remain separate. Update the current-limit copy only for coverage that has actually been validated.

## 5. Local verification and review

Use synthetic fixtures and disposable local services for application checks. External source checks are read-only. Do not alter the user's production account or the existing local journal changes.

Required acceptance checks:

1. All seven pairs can qualify for High and Medium conviction with qualifying US and domestic fixtures, for bullish and bearish directions.
2. Missing, stale, future-dated, zero-net or opposing domestic evidence blocks calls. Headlines, market prices, calendar schedules and unrelated-country data cannot replace it.
3. Base/quote directions are correct, economic indicators retain their units, and each country's evidence stays scoped to the correct markets.
4. A domestic source outage blocks its dependent pair. Shared US/news/calendar failures retain the intended shared scope. Missing health cannot silently pass.
5. Every mandatory grade check still blocks when it fails. Exactly the existing confirming-check exceptions permit Medium conviction. Calendar boundary events remain blocking.
6. Surprise evidence rejects missing actuals, consensus first seen after release, mismatched units, and revisions unavailable at issue time. Snapshot refreshes preserve original economic publication provenance.
7. Existing US-market scoring remains unchanged on identical inputs. Dashboard results and hourly recorded calls use the same graded snapshot, and old-version results do not enter the new track record.
8. Focused unit/integration tests, TypeScript and lint pass. Inspect local portfolio and market-detail pages on desktop and phone. A local read-only source run reports coverage and blocked reasons; zero calls is an acceptable result when the evidence does not qualify.

Review deliverables are the local source-coverage matrix, sample pair explanations, test results and updated portfolio copy. Push and deployment remain outside this plan's authorization.

## Interview explanation while the limitation remains

> MacroFlow currently provides directional FX reads, but it withholds trade calls because verified structured coverage is US-only. The next improvement is adding counterpart economic data while retaining the existing signal checks.

After a pair is validated, describe its actual coverage and measured results. Adding a data source alone does not demonstrate forecasting accuracy.
