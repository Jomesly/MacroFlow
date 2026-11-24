# International economic evidence

Model `macro-factors-v7-4h-2026-11-24` adds country-specific FRED/ALFRED trend snapshots for the seven FX counterparts. An FX call still requires structured evidence from the US and its counterpart economy to support the pair's direction. A connected source does not guarantee a call or establish forecasting accuracy.

The registry is in [`src/lib/international-macro.ts`](../src/lib/international-macro.ts), and acquisition is in [`src/lib/api/international-fred.ts`](../src/lib/api/international-fred.ts). The existing `FRED_API_KEY` is reused; no additional provider key is required.

## Source registry

The following exact series were checked against FRED metadata and the ALFRED vintage of 2026-11-23. All 14 returned observations. The period column is the latest period in that check, not a permanent claim that an observation remains current.

| Pair / economy | Growth series | Complementary series | Latest periods checked |
| --- | --- | --- | --- |
| GBP/USD / UK | [NAEXKP01GBQ657S](https://fred.stlouisfed.org/series/NAEXKP01GBQ657S) | [LRHUTTTTGBM156S](https://fred.stlouisfed.org/series/LRHUTTTTGBM156S), unemployment | GDP Q3 2026; labor July 2026 |
| EUR/USD / euro area | [CLV10MNACB1GQSCAEA20Q](https://fred.stlouisfed.org/series/CLV10MNACB1GQSCAEA20Q) | [CP0000EZCCM086NEST](https://fred.stlouisfed.org/series/CP0000EZCCM086NEST), HICP | GDP Q3 2026; HICP October 2026 |
| USD/JPY / Japan | [NAEXKP01JPQ657S](https://fred.stlouisfed.org/series/NAEXKP01JPQ657S) | [LRHUTTTTJPM156S](https://fred.stlouisfed.org/series/LRHUTTTTJPM156S), unemployment | GDP Q3 2026; labor September 2026 |
| USD/CHF / Switzerland | [NAEXKP01CHQ657S](https://fred.stlouisfed.org/series/NAEXKP01CHQ657S) | [CP0000CHM086NEST](https://fred.stlouisfed.org/series/CP0000CHM086NEST), HICP | GDP Q2 2026; HICP October 2026 |
| AUD/USD / Australia | [NAEXKP01AUQ657S](https://fred.stlouisfed.org/series/NAEXKP01AUQ657S) | [LRHUTTTTAUM156S](https://fred.stlouisfed.org/series/LRHUTTTTAUM156S), unemployment | GDP Q2 2026; labor September 2026 |
| USD/CAD / Canada | [NAEXKP01CAQ657S](https://fred.stlouisfed.org/series/NAEXKP01CAQ657S) | [LRHUTTTTCAM156S](https://fred.stlouisfed.org/series/LRHUTTTTCAM156S), unemployment | GDP Q3 2026; labor October 2026 |
| NZD/USD / New Zealand | [NAEXKP01NZQ657S](https://fred.stlouisfed.org/series/NAEXKP01NZQ657S) | [LRHUTTTTNZQ156S](https://fred.stlouisfed.org/series/LRHUTTTTNZQ156S), unemployment | GDP Q2 2026; labor Q3 2026 |

FRED redistributes the OECD GDP/labor series and Eurostat HICP/euro-area GDP series. Follow each series link for its original source metadata. Several older OECD CPI codes stop in 2021–2025, and the older euro-area OECD GDP series stops in 2023; those series are not used as current evidence.

## Units and transformations

- **GDP, except the euro area:** the `NAEXKP01…Q657S` series already report seasonally adjusted percentage growth from the previous quarter. Positive growth is `expanding`, negative growth is `contracting`, and zero is neutral. These values are not annualized and are not transformed into a second percentage change.
- **Euro-area GDP:** seasonally and calendar adjusted real GDP, millions of chained 2010 euro, covering the euro area with 20 countries. Growth is `(latest / previous quarter − 1) × 100`, using two consecutive quarters. The sign maps to the same growth labels.
- **Unemployment:** seasonally adjusted percent of the labor force. Monthly series compare the latest value with three months earlier; New Zealand's quarterly series compares adjacent quarters. An increase greater than 0.05 percentage points means `weakening`, a decrease greater than 0.05 means `improving`, and a smaller change is neutral. This is an unemployment-rate change, not payroll growth.
- **HICP:** monthly index, 2025=100, not seasonally adjusted. Annual inflation `(index / index twelve months earlier − 1) × 100` is compared with annual inflation three months earlier, requiring 16 consecutive monthly readings. A change greater than 0.1 percentage points is `accelerating`, less than −0.1 is `cooling`, and otherwise neutral. The transform avoids treating an unadjusted index as seasonally adjusted monthly growth.

`trendEvidence` retains the source series, units, frequency, snapshot vintage, availability and retrieval timestamps, observed period end, raw comparison values, and explicitly labeled derived values/units. The event description states that it is a historical trend. Neutral observations are healthy data but add no directional support.

Existing country-specific rules convert these economic readings into each pair's direction. US/base and US/quote pairs have opposite mappings. Country contributions already scored in pair direction are not inverted again by coverage assessment.

## Availability and freshness

Every request sets both `realtime_start` and `realtime_end` to the most recent completed UTC day and sets `observation_end` to that day. The same date bounds and `units=lin` apply to every series. This preserves ALFRED's historical data vintage rather than substituting today's revised values into an older snapshot. See the official [FRED observations API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html).

A vintage dated November 23 becomes conservatively available at November 24, 00:00 UTC. This is **snapshot availability**, not an assertion that all underlying economic releases were published at midnight. The original observation period, the selected historical vintage and the actual fetch time remain separate. No exact original release timestamp is inferred.

Trend snapshots expire after 48 hours. A six-hour cache retains their original vintage and availability time; a cache hit does not extend either. Data retrieval failures are retried after a short cache interval. Repeated snapshots replace the previous series/country observation instead of accumulating multiple votes.

Underlying observations have separate maximum ages, measured from the **end** of the month or quarter:

| Series type | Maximum age after period end |
| --- | --- |
| Quarterly GDP | 180 days |
| Unemployment, monthly or quarterly | 150 days |
| Monthly HICP | 90 days |

The bounds accommodate publication and redistribution lags while remaining finite. FRED labels periods with their start date: an April 1 quarterly observation represents a quarter ending June 30. Its age must not be measured as if the quarter ended April 1. Incomplete periods, future snapshots, missing values and nonconsecutive required comparisons are rejected. Expiry is bounded by both snapshot age and observation age.

## Coverage and provider health

Each counterpart has a `domestic_COUNTRY` health key. Both configured series must be usable for that country's status to be `ok`; a failed request gives `failed`, while missing, stale or unusable measurements give `empty`. Healthy neutral measurements do not manufacture directional events.

Each FX result requires its own counterpart provider to be healthy. For example, a failed UK domestic adapter blocks GBP/USD, while unrelated pairs and US-only markets can still qualify. Shared US, news, market and calendar failures retain their shared scope. Unknown failed providers remain blocking. The hourly recorder and dashboard use the same graded snapshot, so a market cannot bypass its own data-health check.

The seven signal checks and minimum score requirement remain in place. Both economies' net structured contributions must support the forecast direction; a single country's strong score cannot conceal missing or opposing evidence from the other economy. See [the current signal methodology](news-forecast.md).

## Releases and outcome history

International trends are not release surprises. The existing verified actuals/consensus pipeline remains US-only. Calendar schedules and forecast values do not fill a country's structured evidence gap. International surprise scoring requires a separately validated actual-value source and comparable consensus archived before release; this integration does not infer either retrospectively.

Version 7 changes available inputs and pair-specific health, so its outcomes form a separate track record. Previous outcomes remain stored and existing recorded signals can resolve. New data coverage does not validate directional accuracy, and the existing outcome-based “High probability” gate is unchanged.

## Local source check

Run from the MacroFlow project directory:

```sh
npx tsx scripts/check-international-macro.ts
```

The checker uses `FRED_API_KEY` from the environment or the existing `.env.local` convention. It calls the source adapter and pure trend builder directly. It does not call the app, write Redis or a hosted database, or print credentials or provider request URLs.

Output includes each country's status, the exact series, observation periods and directional contributions. An immutable, sanitized snapshot is saved under ignored `.artifacts/international-macro/`, including the raw source observations and normalized provenance. Missing credentials or any unhealthy country produces a nonzero exit code. Passing this check establishes current source usability, not that every pair should issue a call or that any forecast has proved accurate.
