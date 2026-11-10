# Engine restoration: normalization and model-change decision

This is a follow-up to the [portfolio-reference comparison](portfolio-reference-comparison-2026-11-10.md). The conviction repair does **not** complete restoration of the engine behavior from `e52443bff3b65df86d7568c40c68175517db11ef`. Production has not been changed by this work. This follow-up adds an offline diagnostic and recommendations; it does not silently change live model weights or deploy the existing branch.

## Why 70 became 27

Git provides direct evidence of intent. Commit `17cee2b`, November 10 at 19:06 +0800, says unconfirmed headline piles could read around 80% while conviction stayed low. It deliberately replaced the displayed raw score with the share of all possible category points, and explicitly left raw score, direction, conviction and signals unchanged. Tests were added asserting the new denominator. This was an intentional display-metric redesign with an incomplete migration of thresholds, not an accidental arithmetic division.

The sequence matters:

- `e40c094`, 18:36 +0800: replaced the score percentage with an optional validated-probability pipeline and neutralized uncalibrated signals.
- `02bd9e5`, 18:48: restored signed score percentages and macro signals independently of optional outcome calibration.
- `17cee2b`, 19:06: changed the score percentage again, this time to a share of possible category caps.

Neither the commit nor its tests establishes that this last metric improves forecast quality. It addressed a presentation concern by changing score units. A strong rule score with low evidence conviction can be legitimate: strength and evidence quality are different questions. Shrinking the number does not resolve uncertain or bad evidence.

Reference formula: `display = clamp(net points, -100, 100)`.

New formula: `display = round(100 × net category-capped points / sum of all category caps)`.

Gold has a 260-point denominator, so the same 70 points display as 27%. Missing categories remain in the denominator even when no event in them is expected or obtainable. Gold's 20-point yield observation is normalized against a 30-point category cap; under the one-latest-series policy a single yield series cannot fill that cap. Thus this denominator is a rule-system ceiling, not current evidence availability, agreement, or calibrated confidence. It can also change when a rule category is added even if today's inputs are identical.

Cross-market interpretation changes: capacities are Gold 260, GBPUSD 265, Nasdaq 250, Dow 225, Bitcoin 230. The same 70 points display as approximately 27%, 26%, 28%, 31%, and 30% respectively. That is no evidence that Dow's forecast is more reliable than GBPUSD's. Within an asset the transform preserves sign and is monotonic, but it changes magnitude, comparisons across assets, and saturation above 100 raw points.

**The earlier repair has a material limitation:** applying the required displayed-50% conviction gate to this new scale makes qualification much stricter than the reference. With integer points and whole-number rounding, Gold needs at least 129 net points to display 50%; Nasdaq needs 124; GBPUSD 132; Dow 112; Bitcoin 114. In the reference scale, 50 raw points display as 50%. Reference high conviction originally started above 40, so the requested minimum still tightens that older rule modestly.

Recommendation: **reverse the all-category denominator as the primary reference-restoration metric**, rather than treating it as a validated improvement. Restore an explicitly named fixed ±100 **rule-score scale**, preserve uncapped net points for audit, and keep confidence/coverage/market confirmation as separate evidence measures. If a percent sign remains for compatibility, label it a rule-score percentage, never a success probability. This would restore a declared unit contract, not add evidence or make a forecast more likely to be correct. It must be versioned and its thresholds/history explained; silently relabeling 27 as 70 would repeat the original semantic mistake. A capacity-share diagnostic could remain secondary if useful, but should not masquerade as confidence.

## Filtering: retain correctness, revisit lost information explicitly

Reference: recognized economic headline categories could contribute directly. FRED level changes were also assigned labels such as `high`, `strong`, and `beat`. There was no common live as-of selector, no structured-primary requirement, and no mandatory market confirmation for conviction.

Current: economic categories require `trend` or `surprise` evidence with a supported country. Dollar/yield headlines cannot substitute for measured market observations. Structured surprises require actual versus consensus archived before release; future, expired and duplicate evidence is filtered. Policy, risk, earnings and geopolitical headlines can still contribute.

Retain: actual publication timestamps; future-data rejection; country attribution; exact-duplicate removal; measured market observations; distinction between an economic trend and a release surprise; and no invented consensus. The live regex errors already reproduced show why treating any matched headline as a verified release is unsafe.

Revisit: **blanket exclusion of economic headlines** is an information-loss policy, not proof those headlines have no useful information. A constructed cooling-inflation headline contributes +15 Gold points in the reference but zero in the current alignment path. Admitting it in isolation contributes +15 again, while it still cannot qualify as structured primary evidence. Actual news archives are absent, so we cannot quantify the false-negative cost versus avoided false positives.

Recommendation: do not blindly restore all regex headline points. Restore only verifiable release assertions or separately classified expectations after evaluating timestamped, labeled examples. Expected future cuts, released surprises and past trend context must not share an undifferentiated event meaning. For the immediate restoration candidate, retain the filters that prevent false facts, document missing coverage, and do not claim this component is restored until legitimate excluded inputs have a tested path back in.

Market confirmation is also a policy change. Requiring a completed price move for an actionable signal is a confirmation strategy; it can make signals arrive after rather than before news. It does not erase the raw macro score. Retain observation freshness, but distinguish **baseline macro direction** from **market-confirmed qualification** rather than using lack of confirmation to claim there is no directional macro information. A future scheduled release alone supplies no surprise points before its actual exists.

## Trend weighting: changed data meaning and changed weight are separate

Reference FRED CPI used the change in price-index levels, not inflation acceleration; rising payroll levels meant strong employment even with slowing job creation. GDP was nominal and used beat/miss without consensus. A 35-day observation-date cutoff discarded some valid monthly and quarterly data. Current transformations and vintage handling repair these defects and should remain.

The new **0.5 trend multiplier** is separate. It is a heuristic, not a measured reliability coefficient. A ±15-point inflation rule becomes ±8 after symmetric rounding. Reverting it to 1 on the newly transformed inputs would not recreate the original economic information; it would double the weight of a different feature.

The isolated replay changes 7,910/8,335 raw readings, 3,438 direction zones, and reverses the raw sign in 361. Those counts are sensitivity, not wins or losses. A constructed Gold trend basket changes from +8 points (neutral) to +15 (leaning bullish) at full weight.

Recommendation: **retain the corrected transformations and trend/surprise distinction; do not restore full trend weight merely to increase magnitude.** Keep half-weight explicitly provisional until an independent comparison supports a better value. Include full-weight as a candidate, not as a proven restoration. This means the repaired data path will intentionally differ from the flawed reference FRED mapper.

## Regime handling: the largest direct reference departure

The reference API never supplied its optional rate-spread argument. Its live equity activity signs therefore followed the fixed rules. The current engine derives a regime from inflation, labor, real growth and rate spread, then applies it to employment, GDP, PMI and retail:

- `growth_sensitive`: use the existing rule sign.
- `rates_sensitive`: reverse it.
- `mixed` or `unknown`: assign zero and omit that activity event from scored contributions.

On identical strong employment and PMI surprises, Nasdaq is +20 points in the reference, −20 in a rates-sensitive current context, +20 in growth-sensitive context, and zero when mixed/unknown. Fresh economic facts have not disappeared; the model has chosen not to assign them a direction.

The archived 1,667 timestamps comprise 396 rates-sensitive, 930 mixed and 341 unknown contexts, with no growth-sensitive observations. Thus activity is suppressed in 1,271 timestamps (76.2%). Replacing only the scoring override with reference activity signs changes 2,935/8,335 raw readings, 1,763 direction zones, and reverses 320 raw signs (141 Nasdaq, 179 Dow). This leaves the context-quality/qualification gates intact; it is not a full reference rollback.

Recommendation: **move the unvalidated sign-flip/zeroing override out of the reference baseline into a separately visible comparison model**, and use fixed reference signs for the restoration candidate. Keep context and its warnings; do not treat missing context as evidence of safety. This recommendation is justified by fidelity to the requested baseline and the lack of a demonstrated advantage for the replacement, **not** a claim that growth always moves equities the same way. The regime model could be promoted later if independent results support it. Merely reverting sign logic would still leave new input transformations, filters and qualification gates, so it must not be advertised as an exact clone.

## Repairs to retain in all candidates

Aggregate before category caps; score-relative agreement; distinct supporting categories; rejection of duplicate evidence; supporting rather than opposing high-impact confirmation; consistent capped market confirmation; the live headline fixes; truthful source ages/failures; and separate optional probability calibration. Core original-market rule weights and category caps do not need increasing. The absolute displayed 50% high-conviction minimum remains mandatory on whichever documented scale is chosen.

## Diagnostic and limitations

Added `scripts/audit-engine-changes.ts`. The initial diagnostic cloned source and changed one expression per variant. The completed implementation now uses explicit frozen research policies, avoiding source rewriting; live callers retain the default policy. Inputs are selected as-of from prior-day ALFRED vintages and completed market bars. There is no fitting or outcome-based model selection. See the [final implementation and outcome report](restoration-final-report-2026-11-10.md).

```powershell
npx tsx scripts/audit-engine-changes.ts --data=C:/CodingProjects/MacroFlow/data/validation-v3
```

Output: `.artifacts/engine-change-audit.json`, including source hashes, explicit policy definitions, seven constructed cases, capacities and historical counts. Reference-scale-only changes zero raw scores/directions and restores four qualified readings in this limited archive. Economic-headline admission changes zero historical rows **because the archive contains no news**; that is not evidence the filter is harmless. Do not add the change counts across variants: effects overlap and interact.

The diagnostic completed across 8,335 rows. ESLint for the new script and full TypeScript checking pass. No runtime changes, deployment, or new performance claims were made in this follow-up. Existing unit/browser checks from the preceding repair remain software checks, not evidence of prediction accuracy. The prior claim of a completed investigation must not be read as completion of the broader engine-restoration objective.
