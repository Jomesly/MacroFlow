# Four-hour market and news forecast

The dashboard and `/api/bias` use `market-news-v2-4h-2026-11-12` across all 12 markets. The forecast extrapolates recent asset price action and news over the next four hours. Its signed score runs from -100 to +100; it is not a probability or a forecast percentage return. Buy/sell labels express this speculative forecast, including low-confidence forecasts. The separate macro signal remains available in `forecast.macroSignal`.

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

Confidence is a heuristic input-quality label. High confidence requires magnitude at least 60, agreeing price/news components and at least two identified news sources. Medium confidence requires magnitude at least 30 with either fresh asset prices or multiple news sources. Otherwise confidence is low. Probability remains unavailable. Earlier macro backtests do not validate this forecast.

## News and presentation

Existing feeds are supplemented with Yahoo equity news and MarketWatch Market Pulse. `RSS_EQUITIES` can override the Yahoo feed (an empty value disables it). QQQ, SPY and DIA headline aliases map to their corresponding cash indices; these ETFs are news references, not additional dashboard instruments. Foreign stock-market stories are filtered from generic US equity sentiment. Both upward and downward price/news cases have regression coverage.

Cards show a signed score out of 100. Market details show the observed session/hour moves, price proxy where applicable, component weights, four-hour issue/expiry window, and separate macro assessment. Forecast history and direction-change notices use the new model version.

## Verification

```sh
npm run forecast:check -- --url=http://localhost:3188/api/bias
```

The check verifies all 12 markets, current model, fresh issue times, usable evidence, valid four-hour windows and component arithmetic. `--require-price` additionally requires a fresh own-market quote for every market; use it while all relevant markets are open. Each run saves an immutable snapshot under ignored `.artifacts/forecasts/`. This is an operational check, not a realized-outcome accuracy test.
