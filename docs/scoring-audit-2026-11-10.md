> Historical feature-branch checkpoint. The [production integration report](production-merge-2026-11-10.md) supersedes its release status, API paths, dependency versions, and current test counts. The five-asset backtest remains historical evidence and does not validate the expanded twelve-asset dashboard.

# Macro bias scoring audit — 2026-11-10

## Verdict

**Follow-up:** The economic-input, live/replay regime, and evaluation defects described below have now been repaired for a four-hour horizon. This audit is retained as the original findings; see [the implementation and remaining limitations](macro-alignment-v3.md) and [the new validation results](backtest-report-v3.md) for current status. Statistical trading accuracy remains unproven.

The engine is a rule-based macro/news indicator. Its output is not yet validated as an accurate forecast of market direction. This audit reproduced and fixed arithmetic, evidence-counting, classification, and presentation defects. Those repairs improve internal consistency; they do not establish a trading edge or calibrate the displayed percentage as a probability.

The five-asset rule table contains plausible directional hypotheses, but fixed weights and relationships need testing across regimes. Economic releases should be interpreted relative to expectations, and growth news can affect equities differently depending on the state of the economy. See the [Federal Reserve research on equity reactions to macroeconomic news](https://www.federalreserve.gov/econres/feds/files/2025007pap.pdf) and the [New York Fed research on state-dependent announcement responses](https://www.newyorkfed.org/medialibrary/media/research/economists/goldberg/time_variation_march2015.pdf).

## Confirmed defects repaired

1. **Feed order changed the score.** In `src/lib/engine.ts`, clipping each category after every event discarded earlier excess contributions. US100 events with Fed contributions `+40, +40, -40` produced 0 in that order and +40 when reordered. Contributions now aggregate within each category before the category cap, then the final ±100 cap. Opposing events stay visible. Driver values are explicitly labeled as rule inputs before caps.

2. **Agreement could confirm the opposing side.** The old percentage always chose the larger of bullish and bearish event counts. A score of +50 supported by 3 of 8 events showed 63% agreement, even though that 63% opposed the score. It now shows 38% support. A zero net score reports zero directional support.

3. **Conviction overstated the evidence.** A high-impact opposing event could qualify an otherwise medium-impact setup for high conviction. Repeated headlines in one category could also count as multiple confirmations. High conviction now requires three net-supporting categories, a supporting high-impact event in a supporting category, at least 60% event agreement, and magnitude above 40. Medium requires two supporting categories, supporting high-impact evidence, majority agreement, and magnitude above 25. These remain heuristic thresholds, not measured confidence levels.

4. **Exact duplicates and coverage.** The engine deduplicates identical event signals and the same article URL/signal from multiple feeds. Coverage now counts distinct categories instead of dividing event count by a rule count that included mutually exclusive outcomes. RSS/Finnhub signal deduplication now includes country, so a US event does not discard a UK event with the same category/value. Different URLs covering the same underlying release remain a limitation.

5. **False classifications.** Added safeguards against treating a Fed hold as dovish, attributing an ECB-only cut headline to the Fed, inferring dollar weakness from a bare Gold/XAUUSD mention, and treating a bitcoin price move as a crypto-regulation event. News and merged cache keys were versioned to avoid immediately reusing old classifications.

6. **Numeric surprise helper.** `classifyEconomicEvent` now requires finite actual and forecast values and a nonzero surprise. It distinguishes the BoE from the Fed and no longer treats “Core Retail Sales” as inflation. This helper is currently not called by the live FRED adapter, so this repair does not resolve the FRED limitations below.

7. **Display accuracy.** Bipolar bars now use half the track for each direction: previously ±50 already filled its entire half, visually resembling ±100. Removed claims of technical confirmation, an inferred fear/greed gauge that confused gold's safe-haven response with risk-on sentiment, and the daily summary's unsupported risk-on/off inference from the number of bullish/bearish assets. The detail panel explains what the percentage and capped driver contributions mean.

## Remaining blockers to a reliable macro interpretation

### High: FRED level changes are not forecast surprises

`src/lib/api/fred.ts` requests raw levels and compares two observations. Any increase in the CPI index becomes `inflation/high`; that cannot distinguish inflation cooling from, for example, 0.4% monthly growth to 0.2%. PAYEMS is an employment level, so a smaller positive monthly jobs gain still becomes `strong`. GDP uses nominal `GDP`, and a rising level becomes `beat` without consensus. Retail sales similarly uses previous levels as a beat/miss reference.

These inputs need an explicit distinction between economic trend and release surprise. Use suitable transformations and real activity series for trend context, and actual-versus-consensus data for surprises. Do not silently substitute one for the other. The [BLS explains index levels versus percent changes](https://www.bls.gov/cpi/factsheets/calculating-percent-changes.htm); the [FRED API documents raw levels and supported transformations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html).

### High: observation dates, data age, and missing context

FRED freshness uses a universal 35-day limit against the observation-period date. Monthly observations dated on the first of the preceding month can be rejected soon after publication; quarterly GDP is normally much older than 35 days by publication. That silently removes relevant context. FRED explicitly states that [an observation date is the period measured, not its publication date](https://fred.stlouisfed.org/help/data/connecting-fred-to-ai-services/FRED-MCP-Connector).

The market-data adapter timestamps retrieved DXY/yield observations as now rather than preserving their underlying market dates. Several providers swallow fetch errors and return empty lists, so health reporting cannot reliably distinguish no relevant data from an outage. The merged-cache stale fallback is unreachable because valid cache entries return before the refresh path. Missing evidence can therefore look neutral or current.

### High: live/backtest behavior is different

`src/app/api/bias/route.ts` calls `calculateBias(events, symbol)` without a rate spread. The optional regime switch and `fetchRateSpread` are not used by the live route. Replay passes a spread when its data file exists. Replay also accumulates all prior releases, whereas live ingestion uses short news windows and only recent FRED observations.

The existing spread rule is itself unvalidated: a two-year Treasury minus monthly effective federal funds rate is not a sufficient description of the growth/inflation regime. Enabling it without validating timing, data freshness, and behavior could replace one error with another. This audit leaves it inactive in live scoring.

### High: headline interpretation remains heuristic

Regex rules still lack robust handling of negation, anticipated versus realized events, quoted history, and multi-country/multi-clause attribution. Unknown-country macro events can reach generic rules; GBPUSD's generic macro rules can apply a UK-style sign to an unattributed event. Separate stories about one release can be counted repeatedly, while within-feed category/value deduplication can drop distinct releases. Price-action headlines can also become risk-sentiment inputs, so the output is not purely independent fundamental evidence.

Fixing these requires structured release identities, explicit country/time/source metadata, and a labeled evaluation set for news extraction. Category diversity does not prove statistical independence: Fed, yields, and dollar stories can reflect the same shock.

### High: existing backtests do not establish accuracy

The saved report's 5.9% one-day hit rate is incorrect because the generator includes `weakly_bullish` and `weakly_bearish` in its denominator but only recognizes full bullish/bearish predictions as hits. Read-only recomputation from the saved 140 joined records found:

- 101 directional records with valid one-day returns.
- Old logic: 6 hits / 101 = 5.94%.
- Including the leaning directions correctly: 44 hits / 101 = 43.56%.

The latter is a label-only correction on old saved scores, not a backtest of this repaired engine and not a validated accuracy estimate. Additional issues include:

- The saved price data has daily bars, which cannot support the report's purported four-hour precision. The joiner treats a bar close as available at the bar's timestamp and can use the entry bar's earlier high/low in adverse-excursion calculations.
- The ALFRED fetcher specifies `realtime_end` without a matching historical `realtime_start`, traverses vintages newest-first, and deduplicates observation dates at the first encountered vintage. Its claim to preserve first-release information is not established. [FRED documents the distinction between current and historical vintages](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html).
- The chronological 70/30 split operates on individual asset rows, so rows from the same release timestamp can straddle the split.
- Existing replay tests manually filter arrays rather than exercise the actual historical acquisition/replay pipeline. Passing them does not prove the pipeline is free from look-ahead bias.
- Samples are small, the report lacks UK and news inputs, and stored scores predate these repairs.

The historical artifacts and their generator were preserved for this audit. They need a corrected data pipeline and a fresh, versioned replay before being used as validation evidence.

## Validation and next work

Twenty-one targeted regression cases cover order invariance, score-relative agreement, duplicate evidence, distinct dated releases sharing a URL, zero-score behavior, supporting high-impact evidence, both strong directions, missing/equal consensus, and specific false headline classifications. Sixteen of the initial eighteen cases failed before the repairs. The full source unit suite passes 177 tests in 23 files. Lint passes for the changed engine, classifier, news adapters, dashboard components, and regression tests; source type-checking passes with generated Next.js files and local audit artifacts excluded. The normal full-project type-check remains affected by stale generated route types noted earlier in this thread. Browser inspection was not repeated after the tooling failures on the preceding dashboard task.

Next work should first separate trend context from actual-versus-consensus surprises and preserve observation/publication times. Then make live and historical input selection identical, fix the replay evaluation, and validate frozen model versions by asset, horizon, direction, and regime on unseen periods. Until that is done, a +70% or -70% reading means a strong rule score, not a 70% chance of a winning trade.
