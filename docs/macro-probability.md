# Four-hour macro probability

Status: implemented locally on `feature/macro-probability`, based on production commit `ea20062`. No fitted model has been approved. `src/lib/probability/registry.json` intentionally contains `null`.

## What the percentage means

A displayed 62% rise probability would estimate the chance of a higher close after holding for four hours, entering at the next hourly bar open strictly after the recorded prediction. A fall probability uses the same definition with a lower close. Unchanged prices count as unsuccessful predictions. Both probabilities are unsigned.

This is not the probability of hitting a technical target before a stop, and it excludes spreads, fees and slippage. Comparing a selected Long/Short technical direction with the macro lean does not change the probability or validate the combined strategy.

The old signed percentage was a capped sum of rules. It was not a probability. Internal rule scores remain as diagnostic inputs and in explicitly labeled history/methodology. `biasPercent` now returns `null`; clients should use `probability` and handle its unavailable state. No substitute 50% is generated when data is missing.

## Current behavior

- Cards show an unsigned probability only for a supported, validated condition; otherwise they show an em dash and “Probability unavailable.” Macro direction remains visible.
- Validated probabilities at or above 50% appear first, regardless of bullish/bearish direction, followed by lower probabilities and unavailable readings.
- Failed refreshes, stale inputs, expired estimates and incompatible models hide the percentage. A live estimate expires no later than five minutes after its original reading or model expiry.
- A probability-backed signal also requires its approximate interval's lower bound to exceed 50%, in addition to the existing alignment checks. A 50% sorting threshold is not a trade qualification threshold.
- Economic news mentions are excluded from measured economic evidence. Headlines about unrelated prices or individual stocks no longer satisfy the reproduced inflation/broad-risk patterns. Invalid or future news publication times are rejected.
- Flat market observations are labeled unconfirmed; opposing observations are labeled opposing. Neither is silently treated as confirming.

## Calibration and validation

The candidate estimator groups prospectively recorded readings by asset, direction, macro regime, fixed score band, market confirmation and evidence-type set. Its estimate is `(wins + 1) / (observations + 2)` using calibration outcomes only.

A later chronological holdout checks each group without refitting it. Labels crossing the split are purged, duplicate prediction timestamps are rejected, and overlapping four-hour windows are removed per asset. Prices must be hourly, valid and contiguous throughout the holding period; entry must follow capture receipt time.

The initial display gates require all of:

- At least 100 calibration outcomes and 100 holdout outcomes, with at least 30 distinct days in each.
- Approximate 95% Wilson interval width no greater than 20 percentage points.
- Holdout outcome frequency within five percentage points of the calibration estimate.
- Holdout Brier score at least 0.005 better than the calibration-period base rate for the same asset and direction.
- Matching current input model version, complete macro context, structured economic evidence, market observations and healthy fresh feeds.
- Artifact chronology checks and expiry within 30 days after the last holdout outcome.

These are minimum engineering gates, not proof of trading reliability. Non-overlapping outcomes can still be statistically dependent, markets change, and testing many groups can overstate performance. The Wilson interval is approximate and does not account for all model or regime uncertainty. Before promotion, assess sensitivity by day/regime, uncertainty with time-block resampling, coverage and stability. Freeze the method before an additional forward shadow evaluation; do not repeatedly tune against the same holdout. Evaluate actual technical entry/exit rules and execution costs separately.

Independent calibration data and probability-quality metrics follow the principles described in the [scikit-learn calibration documentation](https://scikit-learn.org/stable/modules/calibration.html). The thresholds above are project choices, not guarantees from that source.

## Data workflow

Run capture against a deployment or local server running this reviewed input version. The existing production version is incompatible until the new code is deployed.

```powershell
npm run probability:capture -- --url=http://localhost:3130 --out=data/probability/captures
```

Capture assigns receipt time locally, preserves the API response, and writes one immutable file per UTC hour. Repeating within the same hour fails rather than overwriting history. No scheduled collector or production storage has been installed by this change. A durable hourly collector and monitored price archive are required for ongoing evaluation; a single local capture is only a workflow check.

After sufficient completed outcomes exist, choose and freeze a later holdout start, then fit using instrument-named hourly price datasets in the existing `PriceDataset` format:

```powershell
npm run probability:fit -- --captures=data/probability/captures --prices=data/probability/prices --holdout-start=2027-02-01T00:00:00.000Z --out=data/probability/candidate
```

The date above is illustrative, not an approved experiment split. This writes `candidate.json` and `report.json`. It never updates the registry. Archive the source captures/prices and report alongside the candidate; its SHA-256 records the source content. Review forward results and dataset provenance before explicitly promoting an artifact to `registry.json`. Synthetic fixtures must never be promoted.

For existing historical evaluations:

```powershell
npm run probability:audit -- --evaluation=data/validation-v3/evaluation.json
```

The existing 8,335-row legacy evaluation was rejected for this model: it uses an older version and incomplete `trend-market-only` inputs. It cannot establish the new live predictor's probability or accuracy.

## Verification on 2026-11-10

- 415 unit tests passed across 46 files, including chronology, overlapping labels, incompatible/expired models, separate holdout checks, stale display suppression, company-headline regressions and a synthetic fit-to-inference round trip.
- Optimized production build and TypeScript checks passed.
- Lint and whitespace checks passed before final documentation edits.
- All 31 dashboard/market browser tests and six calendar browser tests passed, including phone/tablet/desktop layouts, automated accessibility checks, unsigned probabilities, expiry, failed refreshes and technical-direction comparisons.
- A local live API capture contained 12 markets, all with `biasPercent: null` and unavailable probability. Even a diagnostic score of -98 did not become a 98% prediction.
- Fitting that single capture against the legacy prices produced zero eligible observations and no groups. Missing, invalid or out-of-date prices were rejected. The registry stayed empty.
- The smoke capture also exposed an unlisted company's share decline being treated as broad risk; the generalized company-share guard was corrected and covered by regression tests afterward. That earlier capture is diagnostic and must not be promoted as calibration data.

No current accuracy, high-probability edge or production readiness of a fitted predictor is claimed. Local implementation checks do not establish financial performance. Production has not been changed by this work.
