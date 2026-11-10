> Historical feature-branch checkpoint. The [production integration report](production-merge-2026-11-10.md) supersedes its release status, API paths, dependency versions, and current test counts. The five-asset backtest remains historical evidence and does not validate the expanded twelve-asset dashboard.

# Four-hour macro validation

Generated 2026-11-10T08:18:14.546Z. Model: macro-v3.2-4h-2026-11-10.

## Verdict

No high-probability claim is authorized by this run. This is a diagnostic of the trend-market-only input profile. Full historical news and consensus-surprise coverage is not available, and the assumed trading costs have not been matched to the user's broker. The dashboard therefore continues to display rule alignment with probability unvalidated.

## Method

- Prices are hourly bars. Entry uses the first bar open strictly after the prediction, delayed by no more than one bar. Exit is exactly four continuous hours later. Session/weekend gaps and incomplete windows are rejected. Daily bars are never substituted.
- Only closed market bars and an ALFRED vintage available before the prediction enter the score. Both FRED real-time date bounds are fixed. Date-only FRED vintages become usable the following UTC day.
- Trend transformations, context selection, freshness, and scoring use the same functions as production. Archived events, when available, must carry their actual availability timestamp.
- The first 70% of unique prediction timestamps form development. The last 30% form the untouched chronological holdout; all assets sharing a timestamp stay together. Development labels reaching the cutoff are purged. Cutoff: 2026-10-23T08:00:00.000Z.
- Metrics use non-overlapping four-hour positions per asset and subset. Leaning bullish/bearish predictions retain their sign. Neutral predictions are excluded. Qualification is frozen: alignment status aligned and conviction high. Thresholds were not tuned to this holdout.
- Round-trip cost assumption: 5 basis points, subtracted from directional returns. These are illustrative costs, not a broker-specific P&L model. MAE uses only bars during the position.
- The always-long or always-short baseline is selected on development and evaluated on matching holdout entry times. Wilson 95% intervals are approximate binomial intervals; residual serial dependence can make them optimistic.
- A research candidate requires at least 100 non-overlapping holdout positions over 30 days, a Wilson lower bound above 50%, positive mean net return, and improvement over the development-selected baseline. This alone is not a calibrated live probability or a guarantee of profit.

## Results

| Asset | Subset | Dev N | Holdout N | Holdout days | Net hit rate | 95% interval | Mean net bps | Baseline | Assessment |
|---|---|---:|---:|---:|---:|---|---:|---|---|
| XAUUSD | all directional | 0 | 0 | 0 | N/A | N/A | N/A | N/A (no baseline) | insufficient sample |
| XAUUSD | qualified alignment | 0 | 0 | 0 | N/A | N/A | N/A | N/A (no baseline) | insufficient sample |
| GBPUSD | all directional | 73 | 39 | 11 | 28.2% | 16.5%–43.8% | -4.82 | 30.8% (always long) | insufficient sample |
| GBPUSD | qualified alignment | 0 | 0 | 0 | N/A | N/A | N/A | N/A (no baseline) | insufficient sample |
| US100 | all directional | 19 | 11 | 11 | 36.4% | 15.2%–64.6% | -9.20 | 36.4% (always long) | insufficient sample |
| US100 | qualified alignment | 0 | 1 | 1 | 100.0% | 20.7%–100.0% | 14.46 | N/A (no baseline) | insufficient sample |
| DJ30 | all directional | 8 | 8 | 8 | 50.0% | 21.5%–78.5% | 24.67 | 50.0% (always long) | insufficient sample |
| DJ30 | qualified alignment | 0 | 0 | 0 | N/A | N/A | N/A | N/A (no baseline) | insufficient sample |
| BTCUSD | all directional | 44 | 33 | 12 | 48.5% | 32.5%–64.8% | -7.41 | 39.4% (always long) | insufficient sample |
| BTCUSD | qualified alignment | 0 | 0 | 0 | N/A | N/A | N/A | N/A (no baseline) | insufficient sample |

## Coverage and reproducibility

- XAUUSD: excluded (unavailable or failed data-quality checks)
- GBPUSD: 1409 hourly bars from Yahoo Finance, fetched 2026-11-10T05:46:34.614Z
- US100: 360 hourly bars from Yahoo Finance, fetched 2026-11-10T05:46:35.085Z
- DJ30: 360 hourly bars from Yahoo Finance, fetched 2026-11-10T05:46:35.591Z
- BTCUSD: 1439 hourly bars from Twelve Data, fetched 2026-11-10T05:46:35.599Z
- DXY: 1156 hourly bars from Yahoo Finance, fetched 2026-11-10T05:46:36.312Z
- US10Y: 420 hourly bars from Yahoo Finance, fetched 2026-11-10T05:46:36.393Z

Excluded at replay time: XAUUSD. Providers: GBPUSD Yahoo Finance; US100 Yahoo Finance; DJ30 Yahoo Finance; BTCUSD Twelve Data; DXY Yahoo Finance; US10Y Yahoo Finance. US100/DJ30 are cash-index references, not broker CFD executions; partial closing bars are excluded. FRED: 60 point-in-time snapshots available 2026-09-12T00:00:00.000Z to 2026-11-10T00:00:00.000Z; archived events: 0. These checks do not certify provider accuracy or broker execution quality.

Total prediction rows: 8335. Rejections: {"Neutral prediction":5702,"Price dataset failed quality checks":573,"Incomplete four-hour window or session gap":263,"No timely entry bar":827,"Incomplete four-hour window":15}.

Evaluation SHA-256: f39b6f7a590fa42848ca6c7b67e6b693bdff78d28d7479c6d9f0925ffde7b4a1. Replay SHA-256: fbc236a6ba45ae0aa6cd48123f25e68d15173dd6bebbddef5162f7bd5d59d52c. Price input SHA-256: XAUUSD 599d01986965, GBPUSD 1b594cfc0220, US100 217d3c79ce0f, DJ30 d102a06c5cca, BTCUSD 1b5fcabd1b4d, DXY 5a8ba10553d4, US10Y db9c28e9ff20.

Raw snapshots, intraday prices, replay and evaluation are in data/validation-v3/ (local, ignored by Git). Existing legacy reports and data were not used. Rerun npm run backtest:replay, npm run backtest:returns and npm run backtest:report after acquisition; use --cost-bps=N with the returns command to inspect cost sensitivity.

Longer licensed intraday history, point-in-time consensus releases and archived news, broker-specific costs, and a new untouched period are required before promoting this diagnostic into full production validation.
