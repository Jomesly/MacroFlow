# GBPUSD and Bitcoin: verified input corrections

Follow-up to the [restoration report](restoration-final-report-2026-11-10.md). Baseline for this change is `ddf155b`. No deployment was performed.

## Why the previous candidate left these directions unchanged

The previous candidate changed the display scale and the equity-only activity regime override. Neither changes GBPUSD or Bitcoin raw points: their activity rules do not use that equity override, and changing display units does not change direction. Equal results were therefore expected, not evidence that these markets were disconnected from their inputs.

This investigation traced their actual input mappings instead of adding weights to force different directions. It found two errors in the retained live capture, plus reproducible adjacent attribution errors.

## Corrected defects

| Defect | Previous behavior | Corrected behavior |
|---|---|---|
| Generic `index` matched any index | A captured rising US Consumer Price Index headline became `risk_on`, adding +10 GBPUSD / +25 Bitcoin before category caps. | Equity risk patterns require an equity subject. Economic and dollar indices no longer supply stock-risk points. Named stock/index moves remain supported. |
| Crypto `ban` matched a word prefix | A captured article about crypto firms and **banks** became a crypto ban, adding -40 Bitcoin points. | Complete action words and inflections are recognized; banks/banking do not mean bans. |
| Generic SEC/regulatory news affected Bitcoin | Unrelated stock-exchange approvals could add +35 Bitcoin points. | Require a crypto subject and regulatory action in the same clause. Unrelated sentences do not supply crypto context. |
| Denial or speculation read as approval | “SEC denies Bitcoin ETF approval” added +35; “SEC has not approved…” and expected approvals could also add +35. | Denials resolve negative, explicit negations and anticipated-only actions do not become completed regulatory events. Actual approvals/restrictions remain supported. Generic regulatory evidence retains medium impact. |
| Bank forecast revision read as rate policy | “Bank of England cuts its inflation forecast” added -30 GBPUSD points. | Forecast/projection revisions are not rate cuts. Explicit rate cuts and dovish policy language remain supported. |

The CPI/banks defects are reproduced from actual retained live article text. The BoE, SEC denial, negation and unrelated-approval cases are constructed regression fixtures, not claims that those headlines occurred in this capture. Some faults existed in the portfolio reference too; restoring them would not improve correctness.

No factor weights, caps, trend weights, directional thresholds or normalization policy were changed in this follow-up. These are input-semantic corrections. They also protect other assets using the shared classifier. Complex natural-language attribution remains heuristic; these tests do not establish perfect headline understanding.

## Same-input comparison

Replayed the retained source text from the November 10, 15:33:45.569 UTC capture through the exact prior classifier and the corrected classifier. Preserved article timestamps, countries, source-level first-signal deduplication and structured inputs. Tested equity-subject, crypto-scope and policy-target changes separately before their combination. Reclassification cannot recover upstream discarded articles.

| Market | Before net points | After net points | Current display before → after | Candidate display before → after |
|---|---:|---:|---|---|
| GBPUSD | -83 | -93 | -31% → -35% | -83% → -93% |
| Bitcoin | -99 | -59 | -43% → -26% | -99% → -59% |

GBPUSD's capped risk category changes from +30 to +20 when the false CPI risk-on evidence is removed. Bitcoin's risk category remains at its +30 cap, but the fabricated -40 regulation contribution disappears. Its score therefore becomes less bearish. Both markets still have enough legitimate negative contributions to remain bearish. Flipping them merely to show a changed direction would be an unsupported change.

The current engine reports low conviction for these below-50 displays. The separate fixed-scale candidate reports high only after the existing magnitude and supporting-evidence gates pass. No sub-50 high label was reintroduced.

Isolated fixture direction changes demonstrate that these are scoring-input repairs: Bitcoin ETF denial changes from +35 (weakly bullish) to -40 (weakly bearish), and a BoE forecast revision changes from -30 (weakly bearish) to 0 (neutral). Those examples are not historical forecasting wins.

## Historical results and coverage

Compared **3,334** GBPUSD/Bitcoin readings against the frozen pre-fix engine on identical vintage-aware historical trend/market inputs. **Zero** point, direction, percentage, category-total or conviction changes occurred. This is expected: that archive has no headlines. The prior four-hour outcome results therefore remain applicable; they cannot measure the new news corrections.

| Market | Directional accuracy | Wilson 95% interval | Directional frequency | Price coverage | Mean net after illustrative 5 bps | Matched always-long net |
|---|---|---|---|---|---|---|
| GBPUSD | 46/85 = 54.1% | 43.6–64.3% | 36.9% | 71.6% | -5.70 bps | -3.62 bps |
| Bitcoin | 30/57 = 52.6% | 39.9–65.0% | 19.8% | 99.8% | -9.15 bps | -9.28 bps |

These are the prior common, nonoverlapping four-hour windows, with neutral readings abstaining. Frequency counts all scheduled timestamps, including periods without usable prices. Costs are illustrative and prices are proxies; technical-entry performance is not evaluated. There is no untouched historical holdout and no demonstrated accuracy or profitability improvement from this change.

The captured bundle contains **7 US structured economic inputs and 0 UK structured inputs**. It has **17 GBP calendar entries but no UK actual values**. The current actual-value adapter is US-only. That coverage limitation remains; inventing UK releases or treating a calendar forecast as an actual would be incorrect. A UK actual-data source with publication provenance is still needed to validate two-economy release coverage. This follow-up does not pretend that removing bad news points fills that gap.

## Cache, versioning and prospective evidence

- Model version is now `macro-v4.2-asset-news-scoping-4h-2026-11-10`.
- News/RSS caches advance to v6; merged inputs advance to v10, preventing old misclassifications from surviving the rollout. Existing bounded freshness, no-store responses and UI consistency safeguards remain.
- The previous prospective manifest and captures were preserved. A separate experiment was registered at `data/prediction-research-asset-news-v2`; it uses the same still-future November 11–February 9 reserved period with a new source hash. No outcomes drove tuning.
- New manifest hash: `45132f3a4bb3042e7fd4a9204167ed12e5ea6ab60492dd8c1d2c7be2e2fa291c`.
- A real capture at **2026-11-10 15:46:53.580 UTC** succeeded with **21 inputs**, healthy provider statuses, and the new model/source hashes. It is pre-period smoke evidence, not a prediction-performance result.
- No unattended watcher was installed or left running. Use the new experiment directory explicitly; old manifests correctly reject changed source hashes.

```powershell
npm run research:capture -- --out=data/prediction-research-asset-news-v2
npm run research:watch -- --out=data/prediction-research-asset-news-v2
# Only after the reserved period, with appropriate outcome prices:
npm run research:final -- --out=data/prediction-research-asset-news-v2 --prices=C:/path/to/prices
```

## Verification and release scope

35 focused asset-news regressions; 18 of the initial 34 failed before the fixes. All **503 tests across 50 files** pass afterward, as do lint, TypeScript and the configured production build. The same-input comparison tests each correction separately and their combination; its source hashes and results are in `asset-news-comparison-2026-11-10.json`.

```powershell
npx tsx scripts/compare-asset-news-fixes.ts
npm test
npm run lint
npx tsc --noEmit
```

**Correctness improved:** verified irrelevant/misread evidence no longer awards points. **Behavior changed:** actual captured GBPUSD and Bitcoin net points change, and constructed denial/forecast cases change direction. **Predictive performance improved:** not established with the available archive.

The verified fixes are ready for a production rollout review. The experimental fixed-scale/regime-restoration candidate remains separately selectable by research code; it has not been promoted into the live default. No push or deployment occurred during this follow-up.
