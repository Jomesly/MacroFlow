# Four-hour news forecast

The dashboard and `/api/bias` now use `narrative-v1.3-4h-2026-11-11`. The primary direction is a speculative forecast from recent narratives, structured releases, measured dollar/yield observations, and a weaker economic trend prior. It can express a bullish or bearish lean when structured confirmation is absent. The existing macro alignment assessment remains separate, including its original score in `forecast.macroBiasScore`.

The forecast covers all 12 existing dashboard markets, including USD/JPY, the six other major dollar pairs, US500, Gold, Bitcoin, Nasdaq and Dow. Rules distinguish Fed policy, BoJ policy, dollar strength, yen strength, and US versus Japanese economic releases. Direct price narratives are scoped to their named asset. A reported rally is treated as a continuation hypothesis, not proof that the next four hours will rise. Yen appreciation maps to a bearish USD/JPY contribution; yen depreciation maps to bullish. These are heuristic mappings, not fitted response estimates.

## Scoring

- Only inputs available at the forecast time enter scoring. Existing expiry remains 24 hours for headlines/releases, two days for trends, and four hours for measured market observations.
- Headlines have a six-hour half-life. Direct asset narratives contribute ?30 points before decay; other headline channels use 80%. Trends use 35% of their existing half-weight contribution. Structured surprises and measured market observations retain their rule weight.
- One article supplies one net vote: its strongest positive contribution plus its strongest negative contribution. When it directly describes this asset's price direction, that narrative takes precedence over generic causal mappings from the same article. Other articles can still oppose it. URLs ignore query strings and trailing slashes for deduplication; matching normalized titles also merge. Within a category, only the strongest positive and strongest negative story contributions count. The final score is clipped to ±100. Displayed driver contributions can therefore sum to a different number.
- Any nonzero net score produces a lean; absolute scores of at least 50 produce a bullish/bearish direction. Exactly balanced or missing inputs stay neutral. There is no random direction when every source is unavailable.
- Forecast confidence remains low unless macro alignment independently qualifies, agrees on direction, forecast strength is at least 50, and at least 60% of contributions agree. A news lean is displayed even when the confirmed trading signal remains neutral.
- Forecast history and browser direction-change notices use a separate model version from macro alignment history.
- Every forecast includes `issuedAt` and `expiresAt`, defining the four-hour period starting at generation time. The detail panel shows this window.

## News coverage and limits

Existing `RSS_*` configuration and `FINNHUB_API_KEY` supply news. FXStreet scanning now covers up to 40 items instead of eight. Distinct articles with the same classification are retained so recency and opposing narratives can be assessed. Missing, invalid, or future publication times are skipped rather than assigned the download time. US and JPY calendar events list USD/JPY as an affected market; Japanese calendar actuals still require a verified adapter before they can supply structured surprises.

Extraction uses patterns, not an LLM or a trained forecasting model. Direct asset clauses reject basic negation and hypothetical wording, but complex attribution, sarcastic language, multi-asset headlines, and differently worded syndication remain limitations. Headlines reporting price moves are not measured momentum. Rule weights and the four-hour continuation hypothesis have not been validated for predictive accuracy. `forecast.probability` remains null. Earlier macro backtests do not validate this model, and no live USD/JPY direction is asserted by the implementation tests.

Regression fixtures cover bullish/bearish news with missing macro data across all 12 supported markets, common broker aliases, asset isolation, negation, multi-asset clauses, Fed/BoE/BoJ tone, yield-country attribution, ETF regulation, recency, stale/future rejection, duplicate stories, conflicting news, trend overrides, provider ingestion, and the live API response.

The cross-market correction recognizes Cable, BTC, NAS100, USTEC, US30, and WS30. Named index moves stay scoped to that index; an explicit broad stock-market or risk narrative can still affect other markets. Pound or euro moves alone cannot supply dollar-index evidence. Generic yield mappings apply to US rates; explicit UK yields affect GBP/USD and Japanese yields affect USD/JPY through separate forecast mappings. New cache and history versions prevent the previous classifications from being reused.

Live-feed checks additionally caught foreign-dollar names being attributed to the US dollar and a Bitcoin article borrowing a stock rebound. Those cases now have regression fixtures. This improves attribution; it does not establish predictive accuracy.

## Check the running predictor

With the current app running, use its actual address:

```sh
npm run forecast:check -- --url=http://localhost:3000/api/bias
```

The command checks that all 12 markets have fresh forecasts, the current model version, usable evidence, and valid four-hour windows. It fails on baseline, stale, missing, or outdated results. Balanced evidence may legitimately produce a neutral forecast. It saves a separate JSON snapshot under ignored `.artifacts/forecasts/` so the issued directions can be compared with subsequent market outcomes. It reports operational readiness only; it does not report a hit rate or a successful prediction of the future.
