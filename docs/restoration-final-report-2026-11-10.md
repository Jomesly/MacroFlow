# MacroFlow prediction restoration: implementation and evidence

Completed November 10, 2026. Reference: `e52443bff3b65df86d7568c40c68175517db11ef`. Inspected production: `178457f05e7f45e90353230af0612a6fa144f200`. Work is on `fix/prediction-scoring-consistency`; **nothing from this investigation has been deployed**. The unrelated original checkout was preserved.

Subsequent targeted work: [GBPUSD and Bitcoin input corrections](gbpusd-bitcoin-followup-2026-11-10.md). That report supersedes the classifier/version/active-experiment status below; the historical outcome results remain unchanged because their archive contains no news.

## Three separate conclusions

1. **Correctness improved.** Fixed mismatched conviction units, supporting-evidence calculations, category-cap inconsistencies, two reproduced headline misclassifications, and stale-response presentation defenses. Tests cover bullish and bearish displayed 49/50/51 boundaries. These are verified software fixes, not evidence of better forecasts.
2. **Behavior changed in a separate candidate.** The candidate restores the fixed reference point scale and fixed equity activity signs while retaining corrected inputs, caps, deduplication and safeguards. It produces more equity direction readings. It is not an exact reconstruction of the reference pipeline, and it is not the live default.
3. **Predictive performance has not been shown to improve.** Available outcomes do not justify promoting the candidate. Its equity samples show lower unpaired accuracy, with small samples, different abstentions and wide uncertainty. Its GBPUSD and Bitcoin direction results are unchanged. No gold outcome comparison is available. The reference's reported pre-news usefulness cannot be verified without archived news and consensus.

The intended product remains a macro direction assessment to compare with the user's technical setup. A directional macro score, a qualified signal and an estimated outcome probability are different outputs. This work does not validate technical entries or a combined trading strategy.

## Root cause and the calculation path

Commit `17cee2b` intentionally replaced the displayed signed score with the share of all possible category caps. Its commit message addressed headline piles reading around 80% despite low conviction, and explicitly retained raw score, direction, conviction and signals. This was a change of units without migrating all thresholds.

Reference display: `clamp(net points, -100, 100)`.

Production display: `round(100 * net category-capped points / category capacity)`. Gold's capacity is 260. Therefore 70 points became 27%. GBPUSD's capacity is 265, Nasdaq's 250, Dow's 225 and Bitcoin's 230. Missing categories remain in the denominator. This measures a share of the rule system's capacity; it does not measure evidence agreement or likelihood of a correct prediction. Adding a rule category can reduce the percentage even when observed inputs do not change.

Production's conviction and alignment gates still used raw points. The existing 50-point gate in `alignment.ts` checked `biasScore`, not displayed `biasPercent`. Fresh production responses reproduced the inconsistency, including Bitcoin at -59 raw points / -26% / high conviction. It was not merely an old browser or CDN response.

The full path now audited is:

1. News providers and RSS supply timestamped, classified headlines. Calendar surprises require a released actual and consensus archived before release. ALFRED supplies vintage-aware transformed trends; measured completed market observations supply dollar/yield moves.
2. The as-of selector rejects future/expired evidence and selects the latest observation per trend/market series. Alignment rejects ambiguous dollar/yield headlines and unsupported economic headlines/countries.
3. Asset rules map categories and values to signed points. Modern trends use half weight with symmetric point rounding. The current equity regime can reverse or suppress activity points; the restoration variant uses the reference signs instead.
4. Exact duplicate evidence is removed. Signed contributions are summed within categories before caps. Opposing points stay visible. Net capped categories produce the score. The uncapped final net, category totals and display denominator remain in the audit record.
5. The display is calculated once. Both conviction and alignment require absolute displayed magnitude at least 50 for high conviction, with supporting category breadth, supporting high-impact evidence and agreement requirements. Alignment additionally requires complete context, structured primary evidence and fresh market confirmation. An unresolved equity regime still prevents qualified signals in the candidate.
6. `/api/bias` recalculates results from the input bundle, applies source-health gating to signals and optional separate probability calibration, then returns `Cache-Control: no-store`. Input caches have bounded freshness/retention; they do not store a separately scored conviction label. Browser requests also use no-store and a shared guard rejects legacy high/sub-50 combinations without raising the number. The browser can retain its prior coherent result after a failed refresh.

Neither reference-style 70% nor capacity-style 27% is a validated 70% or 27% chance of an upward move. The optional empirical probability pipeline remains separate and is not made available by these repairs.

## What is retained, reversed experimentally, or unresolved

| Change after reference | Decision and evidence |
|---|---|
| Aggregate category points before caps; deduplicate; score-relative supporting evidence | Retain. Reproduced order dependence, repeated evidence and conflicting confirmations have focused regression coverage. |
| FRED transformations and vintage/as-of handling | Retain. CPI index levels are not inflation acceleration; payroll levels are not hiring momentum; nominal GDP is not a consensus surprise. Restoring those mappings would restore incorrect meanings. |
| All-category display denominator | Reverse only in the candidate, to restore the declared reference score unit. No extra factor points are awarded. Changing scale alone does not improve direction accuracy. |
| Half trend weight | Retain provisionally. Full weight is tested independently; no robust gain supports doubling it. |
| Equity activity sign flips/zeroing by regime | Reference signs are an isolated variant and part of the candidate. The archived regimes suppressed activity at 1,271/1,667 timestamps (76.2%). That is a major behavioral departure, but its reversal has not demonstrated better forecasts. Keep the regime/context warnings. |
| Economic headline exclusion | Retain in candidate pending news evidence. Test admission separately. Its historical zero effect reflects the absence of archived headlines, not proof the filter helps. |
| Market confirmation and structured-primary gates | Retain for qualified signals; report raw macro direction separately. These gates can delay qualification until after price responds. They do not establish an ability to anticipate a future surprise. |
| Original market rule weights/category caps | No blanket increase or rollback. The main differences were input selection, scaling, trend weighting and regime policy. |

`src/lib/scoring-policy.ts` defines frozen, explicit research policies. Live callers omit the policy argument and retain the corrected current behavior. There is no deployment flag or UI option silently promoting the candidate. `scripts/audit-engine-changes.ts` now uses these explicit policies instead of rewriting source expressions.

## Before-and-after examples

Constructed identical Gold inputs: dovish Fed +30, weaker measured dollar +25, cool CPI surprise +15, with sufficient context and confirmation:

| Engine | Net points | Display | Conviction |
|---|---:|---:|---|
| Exact reference | +70 | +70% | High |
| Inspected production | +70 | +27% | High — inconsistent |
| Corrected current | +70 | +27% | Low |
| Restoration candidate | +70 | +70% | High |

The negative mirror is tested too. The candidate restores a score-unit contract; it does not create evidence. A future CPI actual contributes no surprise points before its release.

For identical strong employment and PMI surprises, reference Nasdaq is +20; current rates-sensitive context produces -20; mixed/unknown produces zero. Candidate is +20 in each regime, but incomplete or unresolved context still prevents qualified signals.

A new live shadow capture at **2026-11-10 15:27:33.555 UTC**, scored by all models from one input bundle, illustrates more than display changes:

| Market | Corrected current: net / display / conviction | Candidate: net / display / conviction |
|---|---|---|
| Gold | -140 / -54% / high | -140 / -100% / high |
| GBPUSD | -83 / -31% / low | -83 / -83% / high |
| Nasdaq | -90 / -36% / low | -60 / -60% / low |
| Dow | -76 / -34% / low | -34 / -34% / low |
| Bitcoin | -99 / -43% / low | -99 / -99% / high |

The final raw score field caps at +/-100; this table uses the retained net-point audit. The snapshot includes 5 trends, 14 headlines, 2 market observations and 2 surprises, plus 105 calendar entries and 45 archived forecasts. All reported provider health fields were healthy. This is an input/behavior comparison captured after receipt, **not** evidence of subsequent forecast success or pre-release knowledge.

## Historical outcome protocol and available coverage

Data: September 12 through November 10, 2026 at 04:00 UTC; 60 ALFRED snapshots, 1,667 distinct archived scheduling timestamps, five original assets, 8,335 readings per variant/profile. All these data were already inspected; all results below are descriptive development results. No portion was relabeled a fresh holdout.

Inputs use only the latest vintage available at the timestamp and completed market bars. No later news, revised consensus or future actual is reconstructed. Asset price files and model sources have recorded hashes in the machine-readable report.

Outcome: enter at the first hourly bar **open strictly after** the prediction, within one bar interval, and exit after four contiguous hours. Reject gaps, invalid data and unavailable prices. Select common nonoverlapping windows from price availability before inspecting any model signal. Every model sees the same windows; neutrals abstain. A flat return is a miss. Accuracy is based on **gross market direction**, separately from returns after costs.

The 1,667 scheduling timestamps are the union of archived market times; the denominator includes weekends, closed sessions and timestamps without usable prices. It is not 1,667 executable opportunities per asset. The common schedule can omit readings occurring later in a session. It deliberately avoids choosing a different favorable schedule for each model; results are conditional on this schedule.

| Asset | Price-eligible timestamps | Coverage | Common nonoverlapping windows |
|---|---:|---:|---:|
| Gold | 0 | 0% | 0 |
| GBPUSD | 1,193 | 71.6% | 240 |
| Nasdaq | 205 | 12.3% | 41 |
| Dow | 205 | 12.3% | 41 |
| Bitcoin | 1,663 | 99.8% | 355 |

Coverage is limited especially for cash equity-index hours. Prices are directional proxies, not assured broker-executable fills. Gold was unavailable or failed quality checks and was not substituted with a different instrument.

## Exact reference versus current versus candidate

The reference predates the modern trend vocabulary. For a fair exact-source comparison, the historical **shared-market profile** gives every engine the same measured dollar/yield inputs. The exact reference source is materialized from Git, without the optional rate spread, matching its actual API usage. We do not relabel transformed trends as reference surprises.

All compared engines have identical directional readings on this profile:

| Asset | Directional reading frequency | Evaluated wins / n | Accuracy; Wilson 95% interval |
|---|---:|---:|---|
| Gold | 40.0% | 0 / 0 | Unavailable |
| GBPUSD | 26.0% | 43 / 70 | 61.4%; 49.7–72.0% |
| Nasdaq | 22.3% | 0 / 0 | No directional reading on the common valid windows |
| Dow | 20.6% | 0 / 0 | No directional reading on the common valid windows |
| Bitcoin | 40.0% | 69 / 130 | 53.1%; 44.5–61.4% |

This cannot answer whether the full reference news/trend engine was better. The old news archive and complete original provider inputs do not exist locally. In particular, the lack of evaluable equity signals on this restricted profile does not mean the original full engine never forecast equities.

## Individual changes, then the combination

On **modern transformed trend + market inputs**, production and the corrected current engine have the same direction outcomes. The correctness repair changes conviction, not these direction predictions.

| Variant | GBPUSD wins/n | Nasdaq wins/n | Dow wins/n | Bitcoin wins/n |
|---|---:|---:|---:|---:|
| Production / corrected current | 46/85 (54.1%) | 7/10 (70.0%) | 5/10 (50.0%) | 30/57 (52.6%) |
| Reference scale only | Same | Same | Same | Same |
| Reference activity signs only | 46/85 (54.1%) | 10/18 (55.6%) | 6/20 (30.0%) | 30/57 (52.6%) |
| Full trend weight only | 71/130 (54.6%) | 20/41 (48.8%) | 13/41 (31.7%) | 70/138 (50.7%) |
| Admit economic headlines only | Same as current: archive contains no headlines | Same | Same | Same |
| Combined restoration: scale + activity signs | 46/85 (54.1%) | 10/18 (55.6%) | 6/20 (30.0%) | 30/57 (52.6%) |

Gold has no evaluable outcomes for any variant. The full-weight variant intentionally remains experimental. Scale-only cannot change direction accuracy. Differences in the other variants include different abstention sets; the percentages alone are not paired improvement estimates.

| Asset | Current frequency → candidate frequency | Current sample days → candidate | Current accuracy interval → candidate interval |
|---|---|---|---|
| Gold | 34.4% → 34.4% | 0 → 0 | Unavailable |
| GBPUSD | 36.9% → 36.9% | 31 → 31 | 43.6–64.3% → same |
| Nasdaq | 39.5% → 56.9% | 10 → 18 | 39.7–89.2% → 33.7–75.4% |
| Dow | 27.4% → 51.0% | 10 → 20 | 23.7–76.3% → 14.5–51.9% |
| Bitcoin | 19.8% → 19.8% | 26 → 26 | 39.9–65.0% → same |

Frequency means non-neutral macro direction across all scheduled timestamps, **not** an actionable high-conviction entry rate. Qualified counts across 8,335 readings: production 4 (2 Gold, 2 Nasdaq), corrected current 0, scale-only 4, combined restoration 2 (Gold). The candidate's two Gold qualifications have no usable prices. There is no adequate qualified-signal performance sample.

Paired candidate-versus-current direction comparisons on jointly active common windows: GBPUSD n=85, difference 0; Bitcoin n=57, difference 0; Nasdaq n=6, difference 0; Dow n=6, difference +16.7 percentage points, daily-cluster bootstrap 95% interval 0 to +50 points. The zero-width intervals for unchanged predictions describe no observed disagreement, not established population equivalence. A six-pair comparison cannot support promotion. Wilson intervals also assume more independence than repeated macro regimes guarantee; the daily bootstrap still cannot remove multi-day dependence or selection bias.

## Costs and simple baselines

These are illustrative mean returns per selected four-hour observation, **not** an equity curve, compounding model, leverage recommendation or validated trading system. Subtract 5 basis points round trip. No broker spread/funding/slippage history or technical entry condition is available. Baselines enter the same windows as that model's active readings.

| Model / asset | Direction accuracy | Always-long direction accuracy | Mean net bps | Matched always-long net bps |
|---|---:|---:|---:|---:|
| Current / GBPUSD | 54.1% | 47.1% | -5.70 | -3.62 |
| Candidate / GBPUSD | 54.1% | 47.1% | -5.70 | -3.62 |
| Current / Nasdaq | 70.0% | 70.0% | +24.85 | -14.60 |
| Candidate / Nasdaq | 55.6% | 55.6% | -6.33 | +3.98 |
| Current / Dow | 50.0% | 50.0% | +15.63 | -31.89 |
| Candidate / Dow | 30.0% | 35.0% | -14.55 | -13.96 |
| Current / Bitcoin | 52.6% | 54.4% | -9.15 | -9.28 |
| Candidate / Bitcoin | 52.6% | 54.4% | -9.15 | -9.28 |

Being right slightly more often than half does not guarantee positive returns. These results provide no broad evidence of tradable improvement. The machine-readable report also includes always-short baselines and every individual variant.

## Fresh evidence collection

Implemented `research:init`, `research:capture`, `research:watch`, and `research:final`. The manifest was frozen before the prospective period, with hashes of scoring, input pipeline, collector, evaluation code and dependencies. Final manifest model hash: `c6836df0945b28af996c93e65ce9a98949da1f569154362673e9302fed254e2e`. The initial smoke manifest and capture were preserved in `data/prediction-research-initial-smoke` when review added a collector hour-boundary fix: a request crossing the hour is assigned to its prediction-completion hour. No outcome informed this collector correction.

- Reserved period: **November 11, 2026 00:00 UTC to February 9, 2027 00:00 UTC**. None of the inspected historical data can enter it. The final evaluator refuses to run before the period closes; this rejection was verified.
- Capture once per UTC hour, never backfill missed calls. All variants consume one input bundle. Predictions are timestamped no earlier than scoring completion. Save received/source timestamps, context, health, raw classified event text, points, model outputs, hashes, actual/consensus evidence and archived calendar forecasts.
- Create-only atomic files preserve the first hourly capture. Duplicate capture refusal was verified. Invalid/stale/failed captures remain logged but are ineligible. A changed source hash requires a separately registered experiment.
- Predeclared primary comparison: candidate versus corrected current, four-hour direction, matched windows, coverage and abstentions. Require at least 100 nonoverlapping paired observations and 30 observed days per asset; insufficient data remains inconclusive. Use daily-cluster 99% individual intervals across the five original assets. Do not tune during the holdout or repeatedly inspect outcomes to decide when to stop.
- The successful November 10 capture is **pre-period smoke evidence**, not holdout data. No future outcomes have been evaluated.

**Operational status:** local logging is implemented; the final collector captured 23 healthy inputs at 15:33:45.569 UTC after the initial smoke capture above. It is not deployed into production, and no persistent scheduled job or background watcher was left running. To collect the reserved period, run the provided foreground watcher on an always-on host with the existing provider environment. Keep the manifest and capture directory durable and backed up. Missed hours remain missing; if collection cannot cover the period, do not claim validation.

```powershell
npm run research:init
npm run research:capture
npm run research:watch
# After the sealed period, provide quality-checked hourly price archives:
npm run research:final -- --prices=C:/path/to/prospective/prices
```

The logger preserves the exact scored input bundle, not a complete raw news-wire archive. Upstream unclassified/discarded articles remain unavailable, so future classifier recall analysis may require a licensed raw feed. A stored calendar forecast does not imply a predictable surprise. Technical setup/entry decisions must also be recorded prospectively before any claim about macro-plus-technical performance.

## Validation and reproducibility

- 468 unit/regression tests across 49 files pass, including individual policies, combined candidate, both-sign threshold boundaries, future release exclusion, conflicting categories, outcome-versus-cost distinction, immutable logging and release provenance.
- ESLint, TypeScript and the configured Next.js production build pass.
- Earlier browser validation of the conviction/API guard: 23 checks across dashboard and market detail. No UI change was introduced in this candidate phase.
- Full historical comparison completed on both shared-market and modern-input profiles. Source/data hashes and per-variant outcomes: `.artifacts/restoration-evaluation.json` (local); a copy is retained alongside this report.
- Live capture succeeded; same-hour replacement was refused; premature holdout evaluation was refused. No deployment or production write of scoring policies occurred.

```powershell
npx tsx scripts/evaluate-restoration.ts --data=C:/CodingProjects/MacroFlow/data/validation-v3
npx tsx scripts/audit-engine-changes.ts --data=C:/CodingProjects/MacroFlow/data/validation-v3
npm test
npm run lint
npx tsc --noEmit
```

Related investigation: [normalization and restoration decisions](engine-restoration-decision-2026-11-10.md), [exact portfolio reference](portfolio-reference-comparison-2026-11-10.md), [production regression trace](prediction-regression-2026-11-10.md).

The justified delivery is a corrected scoring implementation, a separate reproducible restoration candidate, completed limited comparisons, and a prospective evidence path. The current evidence does not justify calling the candidate a better predictor or replacing production with it.
