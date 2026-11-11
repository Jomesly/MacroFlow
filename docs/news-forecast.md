# Four-hour market and news forecast

The dashboard and `/api/bias` use `market-news-v2.1-4h-2026-11-12` across all 12 markets. The primary percentages estimate the chance of direction over the next four hours: for example, 65% up and 35% down. They are uncalibrated model estimates, not expected percentage price moves or measured trade win rates. Buy/sell labels express this speculative forecast, including low-confidence forecasts. The separate macro signal remains available in `forecast.macroSignal`.

## Estimated direction percentages

`forecast.directionChance` is separate from the empirical calibration subsystem. It contains complementary `upPercent` and `downPercent`, `horizonHours: 4`, issue/expiry times, `modelVersion: heuristic-logit-v1`, and `calibration: unvalidated`.

Let `e` be the weighted sum of available component scores divided by 100. The model assumes `P(up) = 1 / (1 + exp(-ln(4) * e * c))`, with `P(down) = 1 - P(up)`. Coverage `c` is 1 with fresh own-market prices, 0.7 with news from at least two sources but no price, 0.5 with fewer news sources and no price, or 0.35 for macro-only inputs. These coefficients are design assumptions, not fitted or validated probabilities. They limit either direction to 80%, reducing certainty when price evidence is missing. Both percentages are rounded together to one decimal and sum to 100%.

This is a binary directional model; it does not assign a separate probability to an unchanged price. Balanced usable evidence produces 50/50. Absent or malformed evidence produces `unavailable`, not an invented probability. The API withholds estimates for stale/baseline snapshots; clients also hide blocked, future, malformed or expired estimates. Forecasts compare direction over the four hours after issuance, not an individual trade's outcome. News-only forecasts lack a fresh price anchor and should be treated as narrative direction estimates.

The internal signed score remains for auditing and history. The legacy calibrated `probability` remains unavailable, and `forecast.probability` remains null. No historical accuracy claim is implied by the new percentage model.

## Why this version changed

The previous deployment showed Nasdaq at -1 and S&P 500 at -2 during a strong rally. Its market adapter fetched only DXY and Treasury yields, never the asset being forecast. Multiple slow macro penalties could offset the entire bullish-news contribution. Operational source-health checks did not catch this directional defect. A regression now exercises the actual adapter-to-forecast path with a rally and opposing dollar/yield inputs.

## Inputs and weighting

- Asset quotes cover the three US cash indices, seven dollar pairs, Bitcoin spot and a clearly identified gold-futures proxy. The Yahoo chart request uses `range=1d`, so its prior close is not accidentally the beginning of a five-day chart.
- Quotes must be dated within the past 30 minutes. Missing, future, malformed or older quotes are omitted. Failed individual markets do not discard the others. Closed cash sessions therefore fall back to news and macro context once their quotes expire.
- Price trend combines the session return (60%) and approximately the latest hour (40%). Each is bounded with a symmetric tanh transform using fixed asset-class scales. The hourly comparison uses a five-minute bar that was complete at the comparison time. A recent reversal can pull against the session return. This is a continuation heuristic, not a trained return model.
- Relevant market news includes direct asset moves, risk appetite, earnings, crypto regulation and geopolitical events. Policy and economic news remain available as background, or become the news component when no market-specific news is present.
- With all components present, price trend gets 60%, news 30%, and macro background 10%. With price and news only, the split is 65/35. With either price or news plus macro, the split is 80/20. A sole available component gets full weight.
- Headlines retain a six-hour half-life. Each story gets one net vote; direct reporting about the asset takes priority over causal mappings from the same story. Duplicate URLs/titles merge, and within each category only the strongest positive and negative contributions count. The news component scales its category total by 1.5, capped at 85 points in either direction.
- The API exposes the component scores and actual weights. Macro penalties stay in one bounded component, preventing several correlated economic series from drowning out the asset's own trend.
- Any nonzero forecast issues a buy/sell lean. Exactly balanced or absent inputs stay neutral. Missing FRED/calendar confirmation no longer suppresses a usable news or price forecast. Stale or baseline API snapshots still suppress actionable signal labels.

Confidence is a heuristic input-quality label. High confidence requires magnitude at least 60, agreeing price/news components and at least two identified news sources. Medium confidence requires magnitude at least 30 with either fresh asset prices or multiple news sources. Otherwise confidence is low. Empirically calibrated probability remains unavailable. Earlier macro backtests do not validate this forecast.

## News and presentation

Existing feeds are supplemented with Yahoo equity news and MarketWatch Market Pulse. `RSS_EQUITIES` can override the Yahoo feed (an empty value disables it). QQQ, SPY and DIA headline aliases map to their corresponding cash indices; these ETFs are news references, not additional dashboard instruments. Foreign stock-market stories are filtered from generic US equity sentiment. Both upward and downward price/news cases have regression coverage.

Cards and market details show the favored direction percentage and an up/down percentage chart. Market details retain observed session/hour moves, price proxy where applicable, internal component scores and weights, four-hour issue/expiry window, and separate macro assessment. Model strength history explicitly shows internal scores, not past percentages. History and direction-change notices use the new model version.

## Verification

```sh
npm run forecast:check -- --url=http://localhost:3188/api/bias
```

The check verifies all 12 markets, current model, fresh issue times, usable evidence, valid four-hour windows, component arithmetic and matching complementary direction percentages. `--require-price` additionally requires a fresh own-market quote for every market; use it while all relevant markets are open. Each run saves an immutable snapshot under ignored `.artifacts/forecasts/`. This is an operational check, not a realized-outcome accuracy test.
