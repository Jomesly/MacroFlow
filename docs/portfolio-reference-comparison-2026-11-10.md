# Portfolio-reference comparison and production-path audit

Reference: **`e52443bff3b65df86d7568c40c68175517db11ef`**, November 1, 2026. This is the user's stated useful reference, not an independently established accuracy benchmark. This report extends [the initial repair investigation](prediction-regression-2026-11-10.md); the earlier `02bd9e5` comparison is retained only to isolate the later normalization change.

## Production recheck

At November 10, 2026, 14:48:48 UTC, Vercel still identified production as `178457f05e7f45e90353230af0612a6fa144f200`, deployment `dpl_7QT2ka2UYSABVkPdbrdXxL6bn7CH`. The repair branch has not been deployed.

The public `/api/bias` response returned `X-Vercel-Cache: MISS`, `Age: 0`, source timestamp `14:48:45.362Z`, and scoring timestamp `14:48:47.671Z`. Source was `live`, all six source-health entries were `ok`, and `stale` was absent. Bitcoin was **−59 raw points, −26%, high conviction, aligned**. The payload's model was `macro-v4-probability-4h-2026-11-10`.

Therefore an old HTTP response or browser calculation is not needed to reproduce the defect. The deployed `alignment.ts` checks `abs(biasScore) >= 50`, not `abs(biasPercent) >= 50`. −59 passes the raw gate while `round(100 × −59 / 230) = −26` is shown on screen. `17cee2b` changed the displayed normalization without migrating the gates. The same API model-version string spans that normalization change; Vercel's Git SHA was checked separately rather than inferring the deployed revision from the model string.

## What changed after the portfolio reference

The canonical rule weights for the five original markets are unchanged. For example, Gold Fed tone remains ±30, dollar ±25, yields ±20, and inflation ±15. Original category caps are also unchanged. New assets and central-bank categories were added; generic/duplicate UK aliases were removed in favor of explicit country rules.

Meaningful changes were elsewhere:

- **Aggregation:** the reference clips a category after each event. Current scoring sums first and caps afterward, retaining opposing evidence. This removes feed-order dependence. The reference also counts duplicate events and counts events rather than distinct supporting categories.
- **Evidence quality:** the reference's agreement is the larger bullish/bearish event fraction, even when that majority opposes the weighted score. A high-impact opposing event could help qualify conviction. Later repairs make support relative to the score and require supporting category breadth/high-impact evidence. These repairs are retained.
- **Economic inputs:** reference FRED compared two levels, e.g. a higher CPI index became `inflation/high` and a higher payroll level became `employment/strong`. Its nominal GDP level used a beat/miss label without consensus. A universal 35-day observation-date cutoff could discard recently published monthly/quarterly releases. The current adapter uses economic transformations and publication-aware vintages, separates trends from verified surprises, and gives trends half weight.
- **Regimes:** the reference has an optional rate-spread argument, but its actual live API calls `calculateBias(events, symbol)` without one. Production now passes a structured context. Equity activity can reverse in a rates-sensitive regime, follow growth in a growth-sensitive regime, or contribute zero when unresolved. This is a material directional hypothesis, not a proven improvement; no regime weights were retuned in this repair.
- **News eligibility:** current scoring excludes economic headlines as substitutes for measured trends or consensus surprises, and requires measured dollar/yield evidence. Reference scoring admitted those headline classifications directly. A larger pre-news reference score may therefore reflect additional, less-verified inputs rather than better forecasting.
- **Market timing:** reference DXY came from quote metadata and yields from daily observations, both stamped at fetch time. Current inputs use completed hourly observations and retain actual observation time. Thresholds remain 0.2% for DXY and 0.03 percentage points for yields.
- **Conviction and normalization:** the reference displays the raw total capped at ±100 and labels high above 40 points with enough events/impact/agreement. Later alignment adds a 50-raw-point gate. `17cee2b` divides category-capped net points by all possible category caps but leaves those raw-point gates intact. Neither percentage is an estimated outcome probability.

No evidence supports reverting all these changes. In particular, restoring the older duplicate counting, order-dependent clipping, or inaccurate release-surprise interpretation would reintroduce verified defects.

## Full input-to-screen path and caches

1. `api/finnhub.ts` and `api/rss.ts` classify articles with published timestamps, reject invalid/future/over-48-hour articles, and select one category/value/country signal per source. Provider classification caches last five minutes. The repaired keys are `finnhub_news_v5` and `rss_events_v5`.
2. `api/fred.ts` builds context/trends from a completed prior-day vintage; successful snapshots cache for six hours and partial snapshots retry after one minute. Calendar surprises require numeric actuals and consensus archived strictly before release. Missing consensus is not filled with a previous observation. Market observations cache for two minutes.
3. `api/index.ts` combines **inputs**, not `BiasResult` objects. Its process/Redis cache uses a one-minute fresh window and one-hour retention. No-input failures can retain a stale payload with its original timestamp. The repaired merged key is `merged_events_v8` (production uses v7). Provider-cache TTLs still limit source freshness; a browser refresh is not a forced provider refetch.
4. `getEvents` returns those inputs, context and source status. The API calls `scoreMacroAlignment` on every request with the current as-of time. Selection rejects future/expired evidence, replaces older same-series observations, and applies the evidence-type filters. Headline/surprise scoring lasts 24 hours, market observations four hours, and context/trends two days.
5. `calculateBias` deduplicates events/articles, matches rules/countries, applies trend/regime weight, sums and caps categories, and computes percentage. Conviction now consumes that **same rounded displayed magnitude**, with 50% necessary but not sufficient for high conviction. Alignment uses the same 50% gate and shared capped evidence totals. Failed alignment lowers conviction and neutralizes trading signals.
6. `/api/bias` attaches history and the optional probability estimate. Input-health checks can neutralize the trade signal. History stores raw score/direction under the model-version key; it does not determine the current percentage or conviction. A search of runtime call sites found no alternative live route bypassing alignment: the other production caller is the historical replay wrapper. The reference route did call `calculateBias` directly.
7. Dashboard and market detail receive percentage and conviction together from the API. The dashboard counts/ranks/sizes tiles using conviction; neither component computes probability from points. Browser state retains the last successful response on fetch failure. Session storage contains navigation state and prior direction for alerts, not cached bias calculations.
8. The follow-up repair explicitly disables browser/CDN caching of `/api/bias` responses (`Cache-Control: no-store` plus no-store client requests). Source caches remain bounded and intact. A shared `consistentBiasReading` guard prevents a newer dashboard from displaying an older inconsistent high-conviction payload below 50%, even during a failed refresh. It preserves the numerical score and any separately validated probability; it lowers the label/signal and explains the failed gate. This is defense at rendering boundaries in addition to the server scoring repair, not a replacement for it. An already-open old JavaScript bundle still needs refreshing after deployment.

## Identical-input comparisons

`scripts/compare-prediction-engines.ts` now loads the exact reference `engine.ts`, `rules.ts`, and `types.ts` through `git show`, preserving source hashes. It does not rewrite the reference algorithm. Its wrapper uses the same no-spread invocation as the reference live API. The harness selects inputs known at the cutoff **before either engine runs**.

Constructed cases, explicitly not market-performance results:

- Gold dovish Fed +30, weak measured dollar +25, below-consensus CPI +15: reference **+70 points / +70% / high**; production **+70 / +27% / high**; repaired **+70 / +27% / low**. The bearish mirror is −70 / −70%, −27%, −27% respectively, with the same conviction transition.
- Before the constructed CPI timestamp, both receive only Fed and dollar evidence: reference **+55 / +55% / medium**, production/repaired **+55 / +21% / low**. Once CPI becomes available, the first case applies. No actual is used before release.
- Repeated +40 Fed reports followed by −40: reference **0 points**, production/repaired **+40**. The reference lost excess support while clipping incrementally.
- An exact duplicate Gold Fed event: reference **40 points / medium**, production/repaired **30 points / low**. The duplicate contributes no new evidence in the repair.
- Strong payroll and PMI surprises in Nasdaq: reference **+20 points** regardless of supplied modern context (its live route had none); production/repaired **−20** in rates-sensitive context and **+20** in growth-sensitive context. This isolates a substantive direction change that requires independent validation, not an arithmetic rollback.

Historical comparison separates schemas instead of pretending the reference understands modern trend labels:

- On **8,335 readings of identical measured-market inputs**, the reference and repaired engines have **zero raw-point or direction differences**. This checks shared rule behavior, not the full old pipeline.
- The previously documented 8,335-reading modern trend/market replay still compares pre-normalization, production and repaired implementations. Raw direction remains unchanged; four invalid high-conviction readings become low. Feeding new `accelerating/improving` trend labels to the old engine and reporting its ignored inputs as inferior forecasts would be misleading, so that was not done.
- On **12 identical non-trend inputs** from the frozen post-CPI production capture, all five original markets remain directionally bearish/leaning bearish in the reference and current engines. Examples: Gold reference −90 points/−90% high versus production −90/−35% high and repaired −90/−35% low; GBPUSD reference −65/−65% high versus production −75/−28% high and repaired −75/−28% low. These isolate scoring on already classified evidence. The separate full-capture comparison in the earlier report also reclassifies the captured article text and includes modern trends, so its numbers differ intentionally.

Full output: local `.artifacts/portfolio-reference-comparison.json`. It records input/source hashes, fixture inputs, versions and coverage. Reproduce with:

```powershell
npx tsx scripts/compare-prediction-engines.ts --data=C:/CodingProjects/MacroFlow/data/validation-v3 --capture=.artifacts/production-capture.json --output=.artifacts/portfolio-reference-comparison.json
```

The original November 1 provider responses, a complete historical news/consensus archive, and a verified pre-news outcome benchmark were not located. Your observation remains a valid hypothesis, but the available comparisons do not prove the reference was more accurate or that the repair restores a trading edge. No weights or percentages were inflated to make that claim.

## Verification

The server threshold tests cover ±49%, ±50%, ±51%, and the ±27% inconsistency. API tests check the response caching policy. Rendering-guard tests cover ±20%, ±26%, ±28%, ±49%, ±50%, ±51%, and invalid magnitudes without mutating retained data. Browser tests exercise older inconsistent payloads on both dashboard/detail, failed-refresh retention, and simultaneous percentage/label updates.

Full unit suite: **459 tests in 48 files pass**. **All 23 browser tests** in `bias-display.spec.ts` and `market-detail.spec.ts` pass, including desktop/mobile presentation, legacy payloads, refreshes, navigation and failure recovery. ESLint, `git diff --check`, and the configured production build, including TypeScript, pass. The original repair's news-classification and capped-evidence regression tests remain intact.
