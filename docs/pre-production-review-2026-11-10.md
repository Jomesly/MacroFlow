> Historical feature-branch checkpoint. The [production integration report](production-merge-2026-11-10.md) supersedes its release status, API paths, dependency versions, and current test counts. The five-asset backtest remains historical evidence and does not validate the expanded twelve-asset dashboard.

# Pre-production review — macro scoring changes

> **Historical review, superseded:** the findings below describe an earlier working-tree snapshot. Its six findings were subsequently repaired. Use [the current production-readiness report](production-readiness-2026-11-10.md) for the present recommendation and verification; retain this file as the record of the original reproductions.

**Recommendation: HOLD the production push.** The changes fix substantial defects in the previous engine, but this review found two high-priority scoring bugs and a historical-replay timing defect. Passing tests and a successful build do not cover these cases. Findings below remain open so the reviewed implementation and report can be examined together.

Reviewed on 2026-11-10, branch `feature/dashboard`, baseline HEAD `5137e8d48842b14bbc819f239ab1d3ddcd23d591`. Scope: the tracked working-tree diff against HEAD plus new macro scoring, acquisition, replay, tests, and documentation. The conversation and `docs/macro-alignment-v3.md` are the specification: separate trends/surprises, use context in live/replay, validate four-hour holds, and rank both signs at absolute bias >=50.

No application fixes, commits, pushes, or deployments were performed during this review. Added this report and a local diagnostic under `.artifacts/macro-review-2026-11-10/`. Unrelated existing artifacts, plans, and tsconfig edits were preserved.

## Spec

### S1 — High / P1: rounding can reverse the equity regime

Location: [macro-context.ts](../src/lib/macro-context.ts#L82), unemployment subtraction at line 82 and threshold at line 88.

The documented rule makes a three-month unemployment increase of at least **0.2 percentage points** weakening labor, which takes precedence over the rate-sensitive regime. For **4.4% → 4.6%**, JavaScript subtraction returns `0.1999999999999993`. The `>= 0.2` condition fails.

Using the existing context fixture with that unemployment sequence and a -1 pp rate spread produces `labor: mixed` and `regime: rates_sensitive`. The intended result is weakening/growth-sensitive. A strong US employment surprise then contributes **-10 to US100 instead of +10**. This is a sign error, not merely a display-rounding problem. The final trading signal still depends on all the other gates, but the underlying bias is wrong for this case.

Required repair: normalize rate changes to their meaningful decimal precision or use a carefully bounded numerical tolerance before comparisons. Add boundary tests for 4.4→4.6, values just below/above the threshold, and the resulting equity score.

### S2 — High / P1: regional Fed surveys become monetary-policy surprises

Location: [classifier.ts](../src/lib/api/classifier.ts#L239), activated by the new [calendar adapter](../src/lib/api/calendar.ts#L19).

The first economic-classifier branch matches any event name containing `fed`. A **Philadelphia Fed Manufacturing Index** release with actual 10 and consensus 5 becomes `fed_tone / hawkish`. Richmond Fed Manufacturing Index behaves the same way. These names identify the survey publisher; they do not identify rate decisions.

The reproduced US100 contribution is **-40**, versus **+10** when the manufacturing surprise follows the activity rules in a growth-sensitive regime. The mistaken classification also bypasses the equity activity-regime modulation.

This permissive helper branch existed before the repair, but the new calendar integration now routes structured releases through it. The current calendar account's HTTP 403 prevents those releases from arriving today; correcting entitlement would expose the bug.

Required repair: recognize policy-rate decisions with specific names, classify regional manufacturing/services surveys through explicit activity mappings, and conservatively reject ambiguous release names. Test the complete `releaseToEvent` → shared scorer path, including policy decisions and regional Fed surveys.

### S3 — Medium / P2: future archive errors alter past predictions

Location: [market-evidence.ts](../src/lib/market-evidence.ts#L46).

The four-hour contract requires that a prediction use only evidence available at its timestamp. `buildMarketEvents` runs `priceDatasetIssues(dataset)` on the entire archive before filtering bars to `closeTime <= asOf`.

Reproduction: valid prior/current DXY bars produce `strong` at November 10 noon. Append two identical bars dated November 11: the same November 10 prediction now receives **no market evidence**, because the future duplicates invalidate the whole dataset. Future invalid OHLC rows can have the same effect. Live data would not have contained those future rows, so historical confirmation and qualified trades can diverge from the live decision.

Required repair: retain whole-file acquisition diagnostics, but apply scoring-time integrity checks to the observations available as of the prediction. Add tests showing that future duplicates and future invalid prices cannot change earlier predictions. No evidence was found that this particular defect altered the current clean archived run; the reproduction establishes the pipeline bug.

Other reviewed requirements appear implemented: absolute ±50 sorting; separate trend/surprise evidence; shared live/replay scoring; leaning-direction labels; next-bar-open entry; four continuous holding hours; gap rejection; chronological timestamp split and purge. Trading accuracy is still unvalidated.

**Spec summary: 3 confirmed findings; highest severity P1, incorrect regime selection and release classification.**

## Standards

No `AGENTS.md`, `CODING_STANDARDS.md`, or `CONTRIBUTING.md` was found in the workspace search. No hard violation of a documented repository coding standard was identified. The following are reliability findings and one explicitly labeled maintainability judgment.

### Q1 — Medium / P2: report provenance can become misleading on reruns

Location: [generate-backtest-report.ts](../scripts/generate-backtest-report.ts#L12), lines 12–14 and report template at line 37.

The generator reads the latest `prices/availability.json` independently from the evaluation being reported. Reacquiring prices and then generating the report without replay/evaluation can therefore combine old results with new coverage information. The template also always says gold was excluded and GBPUSD used Yahoo, even if a later acquisition successfully obtains gold or uses another GBPUSD provider.

The current report's statements agree with the observed current acquisition. The defect concerns reproducibility and subsequent runs, rather than proof that the existing table was fabricated.

Required repair: freeze provider, coverage, exclusions, acquisition timestamps, and input hashes into replay/evaluation manifests; derive report statements from that frozen provenance and reject incompatible artifacts.

### Q2 — Low / P3: daily FRED cache entries persist indefinitely

Location: [fred.ts](../src/lib/api/fred.ts#L9) and [cache.ts](../src/lib/api/cache.ts#L30).

The new FRED adapter creates a different cache key each day. The shared cache stores an expiry inside its JSON but sets no Redis TTL. Expired entries are removed only if that exact key is read again, which normally does not happen for yesterday's FRED key. This creates gradual persistent storage growth. It does not make today's lookup consume yesterday's snapshot.

Required repair: set server-side expiration on cache writes, retaining application expiry validation if desired. Test the Redis write options.

### Q3 — Low / P3, judgment: duplicate market classifiers weaken test coverage

Location: [twelvedata.ts](../src/lib/api/twelvedata.ts#L6), [market-evidence.ts](../src/lib/market-evidence.ts#L54), and `src/lib/__tests__/twelvedata.test.ts`.

The old exported dollar/yield threshold helpers have their own implementation and tests, but production classification now occurs separately in `buildMarketEvents`. They currently agree. A future production threshold change could leave helper tests green while actual behavior changes. This is a possible Duplicated Code smell, not a documented-standard breach.

Suggested repair: share the classifiers or move exact-boundary tests to the production path.

**Standards summary: 0 documented-standard violations; 2 concrete reliability findings and 1 maintainability/test-coverage finding. Highest severity P2, report provenance.**

## Verification performed

- `npm test`: **206 tests passed in 27 files**.
- `npm run build`: passed compilation, TypeScript, and page generation.
- `npx eslint src scripts vitest.config.ts`: **0 errors, 1 existing warning** (`eventWithScore` unused in `src/lib/__tests__/engine.test.ts:122`).
- `git diff --check`: passed; Git emitted line-ending conversion notices only.
- Repository-wide `npm run lint`: did not complete during the bounded review run and was stopped. The unignored `.artifacts` directory contains over 2,000 JavaScript/TypeScript files, so this result is not presented as a clean whole-workspace lint pass. Scoped source/script lint completed as above.
- Independently reproduced S1, S2, and S3 with the actual production functions and assertions. Run `npx tsx .artifacts/macro-review-2026-11-10/reproduce.ts` to reproduce the **observed defects**. Its assertions confirm those defects remain present; they are not passing correctness tests. Output is saved to `.artifacts/macro-review-2026-11-10/evidence.json`.
- No new external market-data acquisition or browser test was necessary for these deterministic review findings. The previous implementation's browser smoke check is not a substitute for these missing regression tests.

Observed diagnostic output:

```json
{
  "unemploymentBoundary": {
    "subtraction": 0.1999999999999993,
    "labor": "mixed",
    "regime": "rates_sensitive",
    "actualEquityContribution": -10,
    "intendedEquityContribution": 10
  },
  "regionalFedSurvey": {
    "actualCategory": "fed_tone",
    "actualValue": "hawkish",
    "actualEquityContribution": -40,
    "intendedActivityContribution": 10
  },
  "futureArchiveRows": {
    "before": ["strong"],
    "after": []
  }
}
```

## Data limitations still relevant to release

These are previously observed/documented limitations, not newly verified provider-state claims: the configured calendar account returned HTTP 403; gold history failed executable-session checks; full point-in-time news and consensus archives are missing; the existing diagnostic has only one non-overlapping qualified holdout trade; broker-specific costs are not verified. The short archive cannot support the report's 30-day holdout screen. The earlier holdout has already been inspected and must not be treated as untouched data for model tuning.

Headline extraction also remains heuristic. Resolving the defects above establishes better software correctness, not a proven four-hour trading edge. The current `probability: null` / unvalidated labeling remains appropriate.

## Before a production push

Fix S1 and S2, add the described regressions, and confirm the corrected scores. Fix S3 before using replay results as release evidence. Correct Q1 so subsequent reports are traceable to their actual inputs. Then rerun the suite/build and regenerate the diagnostic, with a model-version update if scoring behavior changes. Address Q2/Q3 as small follow-up reliability improvements.

Review and stage the intended files explicitly: new source modules and tests are currently untracked, while unrelated local artifacts/plans and tsconfig edits are also present. A tracked-files-only commit would omit required modules; indiscriminate staging would include unrelated material.

**Release decision for the reviewed state: hold. No production push has been made.**

## Resolution (2026-11-10, same day)

All six findings were fixed in the working tree. Model version is now `macro-v3.1-4h-2026-11-10` because scoring behavior changed; the local diagnostic was regenerated under it.

- **S1:** the three-month unemployment change is rounded to 0.01 pp before threshold comparisons. 4.4→4.6 now yields `weakening` / `growth_sensitive` and +10 on US100. Tests cover 0.1, 0.2 and 0.3 pp.
- **S2:** regional Fed surveys (Philadelphia, Richmond, Kansas City, Dallas, NY/Empire State, Chicago) classify as activity (`pmi`). Tone is assigned only to explicit policy-rate decisions. Other Fed/BoE/central-bank releases (balance sheet, MPC votes, GDPNow) are rejected. Tested through `releaseToEvent` → shared scorer.
- **S3:** `buildMarketEvents` runs integrity checks only on bars closed at `asOf`. Future duplicates or invalid rows no longer change earlier predictions; invalid rows already known still reject the instrument.
- **Additional fix found while testing Q3:** market changes are rounded before classification. Previously a −0.03 pp yield move computed as −0.0299… and scored neutral.
- **Q1:** replay records per-file provider, fetch time, bar count and SHA-256 plus FRED/archive coverage in `provenance`. The returns step refuses to run if price files changed since replay. The report derives coverage, exclusions and provider statements from the frozen provenance and prints replay/input hashes.
- **Q2:** cache writes set a Redis `px` TTL as well as the in-value expiry.
- **Q3:** `classifyDxyMove` / `classifyYieldMove` live in `market-evidence.ts` and are used by production; `twelvedata.ts` re-exports them. Exact-boundary tests run through `buildMarketEvents`.

Verification after fixes: `npm test` 215 passed in 28 files; `npx tsc --noEmit` clean; `npm run build` passed; scoped eslint 0 errors (same existing warning). `npx tsx .artifacts/macro-review-2026-11-10/verify-fixed.ts` shows the corrected values. The data limitations listed above are unchanged, so trading accuracy remains unvalidated.
