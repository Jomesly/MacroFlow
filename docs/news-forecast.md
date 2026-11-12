# Four-hour news and macro bias

The dashboard and `/api/bias` use `macro-factors-v3-4h-2026-11-12` across all 12 markets. Each market card is a quick read of three things, and the full analysis page behind it holds the reasons:

1. **Bias**: bullish, bearish or neutral for the next four hours, with a **strength percentage** (the size of the lean on a 0–100 scale, not a win rate).
2. **Conviction**: high, medium or low, showing how firmly the factors point one way.
3. **Factors** (on the market page, not the card): the news and macro inputs that may move the chart, each marked bullish or bearish and labeled with its reason (for example "Fed hawkish" or "US yields rising"), with the headline or data point as evidence. Factors that support the bias come first, then the risks against it. One factor is listed per driver channel, matching how the score counts them.

Technical analysis is left to the trader. Price action is **not scored**, so the bias stays independent of the chart, and a trader can check whether their setup agrees with the fundamentals. The intended use is to take setups in the bias direction, preferably with high conviction, and skip or reduce size when the chart opposes the bias.

## Factors

- **News** includes every classified headline: direct reporting on the asset, central-bank actions and tone, risk sentiment, earnings, crypto regulation, geopolitics, currency strength and yield headlines.
- **Macro backdrop** includes structured economic data: release surprises against consensus, economic trends and dollar/yield market observations.
- Each headline has a six-hour half-life. Each story gets one net vote, and direct reporting on the asset takes priority over causal mappings from the same story. Duplicate URLs and titles merge. Within each category only the strongest bullish and bearish contribution counts, so repeated stories cannot manufacture confirmation.
- Fresh asset quotes are still fetched and shown on the market page as price context. They never enter the score or the factor list.

## Score and weights

The news component is 1.5 × its category total, capped at ±100. The macro component is its category total, capped at ±100. With both present, news carries 70% and macro 30%. A sole component gets full weight. The final signed score is capped at ±100 and sets the direction: ±50 or more is bullish or bearish, smaller nonzero scores are weakly bullish or bearish, and zero is neutral.

## Conviction

| Conviction | Requirements |
| --- | --- |
| High | Score magnitude at least 60, at least two independent news sources, and a macro backdrop that does not contradict the news |
| Medium | Score magnitude at least 30, backed by two news sources or by macro data that points the same way |
| Low | Any weaker nonzero lean |

High conviction issues a strong buy or strong sell call. Medium and low conviction issue buy or sell calls. A market with no fresh factors is neutral and says so instead of inventing a lean. Stale or baseline API snapshots suppress all buy/sell calls.

Conviction is a heuristic about the evidence, not a measured win rate. No historical accuracy claim is implied. The legacy calibrated `probability` stays unavailable, and `forecast.probability` is null.

## Feed resilience

Each news feed is retried once. If it still fails, its last successful stories (kept for up to six hours) stand in, and the combined set is refreshed after one minute instead of five. A feed outage therefore cannot silently drop a market's main news source and swing its reading. Stories still fade through the six-hour half-life. Cards are marked "outdated" when the dashboard cannot refresh its data.

## Why this version changed

Version 2.1 showed estimated up/down chances driven 60% by each market's own price trend. That duplicated the trader's technical analysis and hid the reasons behind the reading. Version 3 removes price from the score, drops the chance percentages, and puts the factors themselves on every card, so the dashboard answers the question "what could move this chart, and which way?"

## Verification

```sh
npm run forecast:check -- --url=http://localhost:3188/api/bias
```

The check verifies all 12 markets, the current model, fresh issue times, valid four-hour windows and component arithmetic. It also confirms that price action is never scored and that markets without factors stay neutral. Each run saves an immutable snapshot under ignored `.artifacts/forecasts/`. This is an operational check, not a realized-outcome accuracy test.
