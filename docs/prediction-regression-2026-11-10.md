# Production prediction regression investigation — 2026-11-10

## Finding and scope

Production was inspected at `https://macro-flow-ecru.vercel.app`. Vercel identified deployment `dpl_7QT2ka2UYSABVkPdbrdXxL6bn7CH`, commit `178457f05e7f45e90353230af0612a6fa144f200`. The API reproduced high conviction below 50%, including Bitcoin −26%, GBPUSD −35%, and Nasdaq −42%. Source health reported healthy inputs for that read.

The confirmed regression is `17cee2b` ("base bias percentage on share of possible news points"). It changed the displayed denominator, while explicitly leaving conviction, alignment, direction and signals on the old point scale. Gold's 70 points became `round(100 × 70 / 260) = 27%`, but still met the high-conviction raw-point test. This was also encoded as expected behavior in the API tests. The new layout sized tiles by that overstated conviction, making the inconsistency more prominent.

`02bd9e5`, immediately before normalization, is the comparison baseline for prior display behavior. It is **not a demonstrated last profitable/accurate model**. No independent evidence establishes that the older engine predicted high-impact releases better.

## History reviewed

- `a79f4d6` introduced conviction with magnitude above 40 raw points, event counts, impact and agreement. Its percentage was the capped raw score. It did not estimate outcome probabilities.
- Later fixes added country-specific rules, five direction zones, category caps, and publication-time filtering. These addressed real defects and were retained.
- `4f3dbbb` and its integrated history repaired order-dependent category clipping, score-relative agreement, duplicate evidence, distinct supporting categories, economic transformations, freshness and shared live/replay selection. Trends are separate from actual-versus-consensus surprises. Activity signals depend on the equity growth/rate context. These remain intact.
- `e40c094` added an optional empirical probability pipeline, excluded unverified economic headlines from surprise scoring, and required actual publication timestamps. Its temporary removal of score percentages was reversed in `02bd9e5`, which also restored macro signals independently of the optional probability model.
- `17cee2b` introduced the normalization mismatch. It did **not** alter rule weights or the sign of the underlying point total. Consequently, lower displayed numbers alone are not evidence of worse directional forecasts.

The rule table and economic/market transformations were reviewed; no weights were tuned to reproduce old numbers or improve this replay.

## Calculation contract

1. Select only evidence known at the prediction timestamp. Headlines and surprises expire after 24 hours, market observations after four hours, and economic snapshots after two days. Newer observations replace older ones of the same series. Economic news must be structured trend/surprise evidence with a supported country; dollar/yield confirmation must be measured market data.
2. Match asset/category/value/country to a fixed rule. For Gold, examples are dovish Fed +30, weak dollar +25, falling yields +20, and below-consensus inflation +15. Opposite signals carry negative points. `impact` qualifies evidence; it is not a hidden multiplier. Surprise magnitude is not continuously weighted.
3. Trend evidence receives half weight, rounded symmetrically to an integer. Thus a 15-point rule contributes 8 trend points in either direction. Equity activity contributions use the existing regime modulation; unresolved regimes do not manufacture an activity direction.
4. Deduplicate identical event/article signals, sum contributions within each category, then cap each category. Sum those capped categories into **net points**. Gold's category caps total 260; its capacity is fixed even when some categories have no evidence.
5. `biasPercent = round(100 × net points / category capacity)`, bounded to ±100. Separately, the legacy `biasScore` caps net points at ±100 and determines the direction zone/strength. Raw points and percentage are different units; the methodology now states this explicitly. API `scoring` exposes net points, capacity and capped category contributions so the percentage is reproducible.
6. Conviction uses the **same rounded displayed magnitude**: high requires at least 50%, at least three net-supporting categories, supporting high-impact evidence in a supporting category, and at least 60% event agreement. Medium requires more than 25%, two supporting categories, supporting high-impact evidence and majority agreement; otherwise low. Live alignment can reduce conviction to low and signal to neutral when context, primary evidence, market confirmation, breadth or the 50% strength gate fail. A value of −50% meets the magnitude gate just as +50% does; ±49% does not.

This is directional **rule strength**, not statistical confidence, expected return, or the estimated probability of being correct. Event agreement is a separate unweighted count ratio, not a probability either. The optional probability estimator remains separate and unavailable without a compatible validated model. Existing directions retain their raw-point zones; this change does not silently redefine market direction.

## Additional supported scoring fixes

These are defects found during the investigation, not all newly introduced by `17cee2b`:

- A live article saying stocks were recovering from Thursday's sell-off was scored risk-off because a regex skipped across the recovery to the historical decline. It now scores the recovery as risk-on.
- Another live article described Bitcoin diverging from stocks and declining. The regex attached Bitcoin's decline to "stocks" across a comma. It now contributes no broad-market risk signal. Negative stock/market/equity price patterns require a direct predicate; direct broad-market declines remain supported. This is a bounded fix, not a claim that regex news extraction understands all language.
- Alignment previously summed uncapped market points even though scoring capped them. For example, +75 dollar points and −40 yield points looked confirming at +35, despite their actual capped contribution being +25 −30 = −5. Both paths now share the capped-category calculation.
- A supportive structured event could qualify primary evidence even when an opposing event canceled its category. Structured support now also requires its category to support the net direction.

Classifier and merged-event cache keys were advanced so deployments do not reuse the old classified payloads. Model version is now `macro-v4.1-consistent-scoring-4h-2026-11-10`, separating history/calibration compatibility from the previous model. No database migration is needed.

## Comparisons on identical available inputs

The offline comparison loads scoring code directly from Git for `02bd9e5` and `178457f`, then evaluates the corrected implementation on the same inputs. It records source/data hashes and uses no new provider requests or fitting. Results are saved locally in `.artifacts/prediction-comparison.json`.

### Historical trend/market archive

Used 60 saved ALFRED snapshots and completed hourly market observations, covering 1,667 prediction timestamps from September 12 through November 10, 2026, 04:00 UTC. Five original assets yield 8,335 readings per version. Date-only FRED vintages become usable the following UTC day; future and expired inputs are filtered by the shared selection policy. Legacy synthetic/revised calendar files were not used.

- Pre-normalization: four high-conviction readings, none below 50% on its old display scale.
- Inspected production: the same four high-conviction readings, all below 50% on its new scale.
- Corrected: zero high-conviction readings in this limited trend/market-only archive. All four fail the new displayed-strength gate.
- Production versus corrected: zero raw-score changes, zero direction changes, zero percentage changes in this archive. It contains no archived news to exercise the classifier fixes.
- Example at November 6, 15:30 UTC: Gold remains −58 raw points and −22%; high conviction/strong sell becomes low conviction/neutral signal. Nasdaq remains −58 raw points and −23%, with the same downgrade. At 16:00 UTC the same cases recur.

For descriptive outcome comparison, all three versions have identical non-overlapping four-hour directional results: GBPUSD 33 positive net returns out of 112 windows; Nasdaq 15/30; Dow 9/16; Bitcoin 33/77. Gold has no usable execution-price archive. Entry is strictly after prediction time, four contiguous hours are required, and the existing illustrative five-basis-point round-trip cost is applied. These are **all directional readings**, not results of qualified trading signals. The data was previously inspected and is not a new untouched holdout; these counts do not establish an edge or a new probability estimate.

### Frozen production inputs, including high-impact CPI

The capture was frozen at November 10, 14:36:56 UTC, after obtaining the public events API and the contemporaneous macro context. It contains CPI/Core CPI surprises and policy headlines already available then. Each old scorer receives the captured inputs; corrected scoring reclassifies only the captured article text and reapplies per-source signal deduplication in retained feed order. It cannot recover articles discarded by the original feed filters. This comparison is not backdated to pre-release time.

- Bitcoin: −26% high/strong sell → −26% low/neutral. No score inflation.
- GBPUSD: −35% high/strong sell → −28% low/neutral after corrected news contributions.
- Nasdaq: −42% high/strong sell → −36% low/neutral after corrected news contributions.
- Gold: −40% high/strong sell → −60% high/strong sell. Removing erroneous safe-haven/risk-off contributions strengthens the bearish net evidence; the denominator and weights are unchanged.
- USDJPY: +46% high/strong buy → +56% high/strong buy. USDCHF: +39% → +50%, retaining high/strong buy. These rise because the same news correction changes their risk contributions, not because normalization was relaxed.

The capture's original event payload, bias response and receipt wrapper remain in `.artifacts/production-events-before.json`, `.artifacts/production-bias-before.json` and `.artifacts/production-capture.json`. The comparison report hashes the receipt wrapper. Full input payloads stay local rather than publishing provider content.

### Constructed boundary/news scenarios

Focused fixtures cover ±49%, ±50%, ±51%, and ±27%; canceled primary evidence; uncapped/capped market disagreement; and the two real headline texts. A future-dated CPI surprise is absent before its publication timestamp: the constructed Gold reading is 44%/low before release and 50%/high once available. This verifies time handling and label synchronization, **not actual pre-news predictive skill**. Existing calendar tests also require a forecast archived strictly before release and reject unreleased actuals or absent/equal consensus.

## Validation and reproduction

- New regression file: 10 of 12 tests failed against the inspected production code; all 12 pass after repair.
- Full unit suite: 446 tests in 48 files pass.
- Targeted browser suite: five tests pass, including both signs refreshing 49% → 50% → 49% with matching conviction labels, and failed-refresh behavior.
- ESLint passes. Production build and TypeScript compilation pass using the existing local environment. The first fresh-worktree build lacked Supabase settings; the configured build succeeded without changing unrelated journal code.
- `git diff --check` passes.

```powershell
npm ci --no-audit --no-fund
npm test
npm run lint
npm run build # requires the documented local environment
npx tsx scripts/compare-prediction-engines.ts --data=C:/CodingProjects/MacroFlow/data/validation-v3 --capture=.artifacts/production-capture.json
# Against a running build:
$env:MACROFLOW_UI_BASE_URL='http://localhost:3106'
npx playwright test --config playwright.ui.config.ts tests/e2e/bias-display.spec.ts
```

The capture argument is optional; omit it to reproduce only the historical diagnostic. No historical consensus/news archive or verified earlier forecast benchmark was found. Restoring claimed pre-news accuracy remains unproven. A longer prospective archive and independent evaluation are required before changing heuristic weights on performance grounds.
