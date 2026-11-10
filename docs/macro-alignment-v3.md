# Four-hour macro alignment

Model `macro-v3.2-4h-2026-11-10` implements the requested intraday holding period. It measures rule agreement, not a calibrated probability of winning. See [the validation results](backtest-report-v3.md) and [current production review](production-readiness-2026-11-10.md).

## What changed

- FRED observations supply **trends**, never invented forecast surprises. CPI compares two three-month annualized inflation rates; payrolls compare three-month average job gains; unemployment uses a three-month change; GDP uses quarterly annualized **real** growth from GDPC1; retail uses a clearly labeled nominal three-month change. Trends carry half the corresponding rule weight. Actual-versus-consensus releases use a separate calendar adapter and require finite, unequal actual and estimate values.
- Observation periods and availability times are separate. FRED requests fix both real-time bounds and observation_end. Because the API vintage is date-only, it becomes usable at the next UTC midnight in both live scoring and replay. This deliberately delays same-day FRED information rather than inventing an intraday publication time. Monthly series allow 75 days, quarterly GDP 200 days, matched daily rates seven days; stale inputs produce incomplete context.
- The regime uses inflation, labor, real growth, and matched-date two-year Treasury minus daily effective federal funds rates (DGS2 minus DFF). Contracting growth or weakening labor takes precedence over a rate-cut interpretation. Otherwise, accelerating inflation or a spread below -0.50 percentage points selects the rate-sensitive hypothesis. Other complete combinations remain mixed; incomplete context is unknown.
- Equity activity contributions reverse under the rate-sensitive hypothesis, follow growth under the growth-sensitive hypothesis, and contribute zero when the regime is unresolved. These mappings and thresholds are hypotheses, not estimates fitted to market reaction data.
- Live and replay both call `scoreMacroAlignment`. News/surprises expire after 24 hours, economic snapshots after two days, and market observations after four hours. Future inputs are rejected and old observations of the same series are replaced.
- Dollar/yield inputs come from completed hourly observations, compared with the preceding UTC session's final observation. Dollar moves use a 0.2% threshold; yields use 0.03 percentage points. Price-action headlines cannot supply these inputs. A neutral observed move is distinguished from an absent observation. Market data retains its actual timestamp rather than the download time.
- Alignment requires complete context, a resolved equity regime where applicable, structured economic support, fresh net-supporting market evidence, absolute bias at least 50, at least 60% supporting events, and three net-supporting categories. Missing or conflicting evidence forces low conviction and a neutral trading signal. High conviction also requires supporting high-impact evidence. Bullish and bearish setups use the same gates.
- The dashboard retains the requested **absolute bias >=50** sorting, regardless of sign. It shows alignment status, limitations, regime, observation periods, and evidence types. Percentages remain rule scores; the API returns `probability: null`. Redis history and browser direction-change notices are separated by model version.
- The live check also reproduced a Boeing/BoE substring error. Central-bank matching now requires the BoE word boundary; a regression test protects it.

## Validation contract

Predictions enter at the first hourly bar open **strictly after** prediction time, within one interval. A position exits exactly four continuous hours after entry. Daily data, gaps, partial cash-index closing bars, duplicate timestamps, invalid OHLC, and unverified weekend FX/metal sessions are rejected. Leaning directions retain their bullish/bearish sign. Adverse excursion includes only holding-period bars. Five basis points round-trip is an illustrative cost assumption, configurable per run.

The first 70% of unique timestamps are development and the last 30% holdout, with all assets kept together. Development positions whose exits reach the holdout are purged. Metrics use non-overlapping positions per asset/subset, approximate Wilson intervals, and a development-selected always-long/always-short benchmark on matching holdout entries. Qualification rules were frozen before inspecting holdout results. No weights were tuned to improve this run.

The report is a **trend-and-market diagnostic**, not a full reconstruction of live news. Optional archived events do not automatically make the archive complete. Cash indices are directional references, not executable CFD prices. The 60-day acquisition window cannot satisfy the report's 30-day holdout research screen; a longer independent archive is needed. The currently inspected holdout must not be reused as untouched data for subsequent model selection.

## Observed limitations

- The live economic calendar now uses ForexFactory's weekly feed and FRED first-release actuals for explicitly mapped US releases. Finnhub economic-calendar entitlement is no longer the blocker. Other currencies and unmapped releases are display-only; missing FRED actuals or missing verified pre-release forecasts do not produce surprise evidence.
- The first gold and GBPUSD downloads included changing Saturday quotes. They were rejected for lacking a verified executable session. GBPUSD was replaced with Yahoo hourly data; gold remains unavailable for validation. No gold-futures substitution was made.
- The initial live check returned valid FRED context but no market observations within the four-hour freshness window. All five assets correctly showed insufficient evidence and neutral signals. A later refresh supplied market observations; conflicting/insufficient evidence still kept all trading signals neutral. A more reliable intraday DXY/yield feed is needed for continuous coverage.
- Only **one non-overlapping qualified holdout position** survived. That is not enough to estimate a useful win probability. The broader directional results also fail to establish an edge; see the report for asset-level results.
- News extraction is still heuristic. Negation, forward-looking language, multi-clause attribution, and different articles about one shock remain limitations. Category breadth is not statistical independence. GBPUSD's replay lacks a comparable UK economic archive. Headline effects and full live performance therefore remain unvalidated.
- Provider timestamps/quality and illustrative costs are not broker-verified. Longer intraday history, point-in-time consensus/news archives, broker costs, and a fresh untouched test period are needed before claiming high probability.

## Reproduce

Configure `FRED_API_KEY` and `TWELVE_DATA_API_KEY` in `.env.local`; live news uses `FINNHUB_API_KEY`. The ForexFactory weekly calendar needs no provider key. Its forecast archive uses the server-only Supabase credentials and `supabase/calendar-forecasts.sql`. No credentials are written to reports.

```sh
npm run backtest:fetch-context -- --days=60
npm run backtest:fetch-prices -- --days=60
npm run backtest:replay
npm run backtest:returns -- --cost-bps=5
npm run backtest:report
npm test
npm run build
```

Raw data and outputs are local under ignored `data/validation-v3/`. Context acquisition is resumable. Legacy reports/data are retained but rejected by the new evaluation pipeline. The generated report records the evaluation hash. Do not compare old model history directly with v3 scores.

## Economic calendar and failure handling

The archive freezes the first numeric forecast under `consensus-v2:<event id>`, using the database's receipt timestamp. Scoring compares actuals with that saved forecast, never a revised live-feed value. Empty forecasts do not reserve an earlier timestamp. Forecasts must be recorded strictly before release. Later pre-release revisions are deliberately ignored under this first-consensus policy. Legacy unprefixed rows are retained but excluded from scoring; they cannot be upgraded to point-in-time evidence retroactively. The existing SQL default supports this without another migration.

`/api/calendar` reports `archiveStatus` separately from feed availability. An archive outage preserves the calendar display but excludes its surprises. `/api/bias` source health reports `calendar_archive: failed` and `economic_calendar: failed`; a healthy archive with no eligible surprises reports `ok` and `empty`, respectively. Database details remain server-side. The dashboard shows a warning and Retry button during archive outages.

Successful archive results are shared for 60 seconds through a bounded in-process cache and optional Redis, keyed by feed content. Concurrent work for identical content is coalesced within each process. Cached receipt times remain unchanged, shared-cache expiry is preserved, and failures are not cached. Different server processes may still race on cold cache misses; immutable database conflicts preserve the original record. The bias endpoint obtains the next scheduled event from the calendar result already fetched during ingestion.

The calendar polls every 15 minutes. A failed or malformed refresh retains useful saved events while showing a warning, last-success date/time with time zone, and Retry. Requests time out after 20 seconds. Filter changes work in memory when browser storage is unavailable; persistence remains optional. The weekly feed is cached for one hour and actuals for seven days when found, with missing actuals retried after 15 minutes. These provider-cache periods still limit how quickly changes appear.

## Verification

See [current production review](production-readiness-2026-11-10.md) for the final software checks and limits. Source tests, production build, and browser failure/recovery checks verify implementation behavior, not trading profitability.

## References

- [FRED observation and real-time parameters](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) and [vintage dates](https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html).
- [New York Fed research on time-varying announcement responses](https://www.newyorkfed.org/medialibrary/media/research/economists/goldberg/time_variation_march2015.pdf) supports examining context dependence; it does not establish this model's thresholds or accuracy.
- [Twelve Data timestamps/time zones](https://support.twelvedata.com/en/articles/5745849-timezones) and [historical data](https://support.twelvedata.com/en/articles/5214728-getting-historical-data).
- [Nasdaq session and holiday schedule](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule).
