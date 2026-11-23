# Four-hour news and macro bias

The dashboard and `/api/bias` use `macro-factors-v6-4h-2026-11-24` across all 12 markets. Each market card is a quick read of three things, and the full analysis page behind it holds the reasons:

1. **Bias**: bullish, bearish or neutral for the next four hours, with a **strength percentage** (the size of the lean on a 0–100 scale, not a win rate).
2. **Conviction**: high, medium or low, showing how firmly the factors point one way.
3. **Factors** (on the market page, not the card): the news and macro inputs that may move the chart, each marked bullish or bearish and labeled with its reason (for example "Fed hawkish" or "US yields rising"), with the headline or data point as evidence. Factors that support the bias come first, then the risks against it. One factor is listed per driver channel, matching how the score counts them.

Technical analysis is left to the trader. Price action is **not scored**, so the bias stays independent of the chart, and a trader can check whether their setup agrees with the fundamentals. The intended use is to take setups in the bias direction, preferably with high conviction, and skip or reduce size when the chart opposes the bias.

## Factors

- **News** includes every classified headline: direct reporting on the asset, central-bank actions and tone, risk sentiment, earnings, crypto regulation, geopolitics, currency strength and yield headlines.
- Policy signals must describe a current action, official guidance or current market repricing. Conditional previews and retrospective references do not become new policy signals merely because they mention a rate hike or tightening. These checks operate within the relevant sentence, so a later analyst forecast does not erase a genuine announcement earlier in the story.
- **Macro backdrop** includes structured economic data: release surprises against consensus, economic trends and dollar/yield market observations.
- Each headline has a six-hour half-life and drops out after 12 hours. The market page shows each driver's age and how much of its weight is left, and each card shows when its newest news arrived. A read with no headline from the last 6 hours says so. Each story gets one net vote, and direct reporting on the asset takes priority over causal mappings from the same story. Duplicate URLs and titles merge. Within each category only the strongest bullish and bearish contribution counts, so repeated stories cannot manufacture confirmation.
- Fresh asset quotes are still fetched and shown on the market page as price context. They never enter the score or the factor list.

## Score and weights

The news component is 1.5 × its category total, capped at ±100. The macro component is its category total, capped at ±100. With both present, news carries 70% and macro 30%. A sole component gets full weight. The final signed score is capped at ±100 and sets the direction: ±50 or more is bullish or bearish, smaller nonzero scores are weakly bullish or bearish, and zero is neutral.

## Conviction

| Conviction | Requirements |
| --- | --- |
| High | Score magnitude at least 60, at least two independent news sources, and a macro backdrop that does not contradict the news |
| Medium | Score magnitude at least 30, backed by two news sources or by macro data that points the same way |
| Low | Any weaker nonzero lean |

Conviction describes the lean. It no longer issues buy or sell calls on its own; signals do.

## Signals: news and macro must match

A buy or sell call needs a score of at least 30 and these checks ([plan](plans/2026-11-23-macro-matched-signals.md)):

| Check | Passes when |
| --- | --- |
| Fresh news (under 6 h) supports it | The newest scored headline, and at least one supporting headline, are at most 6 hours old |
| Macro backdrop points the same way | Economic data alone (trends and release surprises) has the score's sign, with at least two supporting series; the US context is complete; and structured evidence from every required economy supports the direction. Dollar and yield moves are judged only in "Dollar and yield moves confirm", so a price move is never counted twice |
| Two or more news sources agree | At least two outlets among the supporting headlines |
| At least 70% of the evidence agrees | Supporting score inputs make up at least 70% of all inputs |
| Dollar and yield moves confirm | Fresh measured US dollar and US yield observations both support the direction, alongside aggregate market confirmation |
| Verified calendar: no high-impact release in the next 4 h | A usable calendar was fetched within one hour, its archive is healthy, its schedule extends through the forecast window, and no high-impact event for the market occurs from issue time through expiry |
| Required data is fresh and healthy | Inputs are live and at most 5 minutes old, the US context is complete and current, required provider health is known, and no configured provider has failed. Explicitly disabled feeds are allowed; unknown calendar coverage is not |

All seven make an **A signal** (strong buy or strong sell). Missing only one of "two sources" or "dollar and yield moves" makes a **B signal** (buy or sell). Anything else is **Lean only**: the bias is shown, with no call. The market page lists every check and whether it passed.

### Country coverage

Each FX pair requires structured evidence for the United States and its counterpart economy: the United Kingdom, euro area, Japan, Switzerland, Australia, Canada or New Zealand. Each economy's net contribution must support the pair's direction. Dollar/yield observations and policy headlines cannot stand in for missing domestic economic data. Gold, bitcoin and US indices require US structured evidence; this is a minimum macro coverage check, not a complete model of every factor that moves those assets.

The current structured adapters provide US FRED trends and verified US release surprises. They do not yet supply equivalent domestic trends for the other economies. Those FX pairs therefore remain **Lean only**, with missing country coverage shown in the forecast limitations and signal checks. Adding vetted domestic adapters, with release-time provenance and expiry rules, is separate work; the app does not fabricate that coverage from US data.

Version 5 changes signal eligibility and policy interpretation, so it starts a separate track record. Version 4 outcomes remain stored but cannot prove this revision. Classified event caches are versioned as well, preventing retained old classifications from resurfacing after rollout.

## Track record and "High probability"

An hourly job (`POST /api/signals/run`, scheduled by `supabase/signal-schedule.sql`) records every A and B signal in `signal_outcomes`, at most one per market every 5 hours, and checks it four hours later:

- Entry is the open of the first hourly bar after the signal, within one hour. Exit is the close of the fourth hourly bar. The four trading hours may span one short pause, such as the daily futures break (22:00–23:00 UTC), but must finish within five hours.
- Prices come from near-24-hour series: stock indices use futures (ES=F, NQ=F, YM=F) because the cash indices only trade 14:30–21:00 UTC; gold uses GC=F, Bitcoin BTC-USD and currencies their Yahoo FX pairs.
- A move in the signal's direction is a win. A flat or opposite move is a loss.
- A closed market, or a window that cannot complete four trading hours within five hours, makes the signal void; void signals are not counted.

`GET /api/signals/track-record` summarizes results for the current model version only; a new version starts a new record. A grade is labelled **High probability** only after at least 100 results, on at least 30 different days, with the lower edge of the 95% Wilson range at or above 55%. That is roughly 65% right at 100 signals, or 61% at 300. Until then cards say "Unproven · n/100 results". These thresholds were fixed before any result was recorded; they are not tuned on outcomes.

Conviction is a heuristic about the evidence, not a measured win rate. No historical accuracy claim is implied. The legacy calibrated `probability` stays unavailable, and `forecast.probability` is null.

## Feed resilience

Each news feed is retried once. If it still fails, its last successful stories (kept for up to six hours) stand in, and the combined set is refreshed after one minute instead of five. A feed outage therefore cannot silently drop a market's main news source and swing its reading. Stories still fade through the six-hour half-life. Cards are marked "outdated" when the dashboard cannot refresh its data. A failed news feed is named next to "Data sources" on the dashboard, and the server log records why it failed (`[rss] feed failed <name> <reason>`).

Retained stories can still explain a lean during an outage, but any failed configured provider pauses new A/B signals. Finnhub's general, forex and crypto desks report health separately, so one successful desk cannot hide another desk's failure. Existing recorded signals continue to be resolved during outages.

On 2026-11-23, FXStreet returned HTTP 403 from the production runtime while its RSS feed still loaded locally. Following the rollout plan, Production's `RSS_FXSTREET` setting is empty, which disables this blocked feed and reports it as `empty`. Forex coverage continues through Finnhub forex news, InvestingLive and Yahoo Finance FX. The Preview setting is unchanged.

## Why this version changed

Version 2.1 showed estimated up/down chances driven 60% by each market's own price trend. That duplicated the trader's technical analysis and hid the reasons behind the reading. Version 3 removes price from the score, drops the chance percentages, and puts the factors themselves on every card, so the dashboard answers the question "what could move this chart, and which way?"

## Verification

```sh
npm run forecast:check -- --url=http://localhost:3188/api/bias
```

The check verifies all 12 markets, the current model, fresh issue times, valid four-hour windows and component arithmetic. It also confirms that price action is never scored and that markets without factors stay neutral. Each run saves an immutable snapshot under ignored `.artifacts/forecasts/`. This is an operational check, not a realized-outcome accuracy test.
