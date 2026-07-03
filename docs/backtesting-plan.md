# MacroFlow Backtesting Plan

## Goal

Validate whether MacroFlow bias scores have measurable forward-return edge before describing signals as statistically high probability.

## Data Needed

- Historical economic calendar events with actual, forecast, country, timestamp, and event name.
- Historical macro/news classifications, or archived RSS/news headlines if available.
- Historical OHLC data for XAUUSD, GBPUSD, US100, DJ30, and BTCUSD.
- Trading-session metadata for market-open assets so forward returns do not cross invalid gaps unexpectedly.

## Evaluation Windows

- 4-hour forward return.
- 1-day forward return.
- 3-day forward return.

Each window should be measured from the timestamp when the bias score would have become visible to a user.

## Buckets

- Symbol.
- Direction: bullish, bearish, neutral.
- Absolute score thresholds: 25+, 40+, 60+.
- Conviction: low, medium, high.
- Source type: economic calendar, market data, RSS/news, mixed.
- Event category: Fed/BoE tone, inflation, employment, DXY, yields, risk sentiment, geopolitical, crypto regulation, earnings.

## Metrics

- Hit rate by direction and horizon.
- Average forward return.
- Median forward return.
- Return distribution percentiles.
- Maximum adverse excursion before target horizon.
- Signal count per bucket.
- False-positive rate for classifier categories after manual review sampling.

## Pipeline Sketch

1. Rebuild historical `MacroEvent` objects from archived source data.
2. Run the current classifier and bias engine at each historical timestamp using only data available at that time.
3. Store resulting score snapshots per symbol.
4. Join each snapshot to forward OHLC returns.
5. Aggregate results by score threshold, conviction, category, and symbol.
6. Report which signals are statistically useful and which should be down-weighted or removed.

## Follow-Up Decisions

- Decide whether category caps should be optimized per asset.
- Decide whether signals need time decay.
- Decide whether source-specific weights are justified.
- Decide whether “strong macro alignment” can later become a true probability label after enough validated sample size.
