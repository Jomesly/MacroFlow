# MacroFlow Backtest Report

Generated: 2026-07-04T12:05:51.119Z

## Executive Summary

This report presents the results of backtesting MacroFlow's fundamental bias scoring engine against historical price data.

**Data source**: This version uses real ALFRED/FRED historical data (vintage-correct point-in-time observations), replacing the previous synthetic-data version. See `backtest-report-SYNTHETIC-DO-NOT-USE.md` for the old report.

### Data Period
- **Start**: 2026-01-09
- **End**: 2026-07-02
- **Total records**: 140
- **Development set**: 98 records (first 70%)
- **Out-of-sample**: 42 records (last 30%)

### Known Limitations
- **No forecast data**: FRED/ALFRED provides actuals only, not consensus forecasts. Classification uses actual-vs-previous-release (month-over-month change), not beat/miss-vs-forecast. This is a different signal than consensus surprises.
- **UK data not included**: FRED has limited UK series coverage. GBPUSD country-specific rules (GB/UK events) are not backtested in this pass.
- **RSS/news scoring not backtested**: Only calendar-driven categories (inflation, employment, GDP, retail_sales) are tested. Dollar strength, risk sentiment, geopolitical, crypto regulation, earnings, and BoE tone are validated forward-only.
- **Sample size**: ~6 months of real data. Most buckets will have small sample sizes. Results should be treated as directional indicators, not conclusive evidence.

---

## Baseline Comparison

| Metric | Value |
|--------|-------|
| Coin flip baseline | 50.0% |
| Actual win rate (1d) | 5.9% |

---

## Bucket Results

### All Data (Development + Out-of-Sample)

| Symbol | Direction | Conviction | Threshold | N | Hit 4h | Hit 1d | Hit 3d | Avg Ret 1d | Reliable |
|--------|-----------|------------|-----------|---|--------|--------|--------|------------|----------|
| XAUUSD | bearish | high | 25+ | 6 | 16.7% | 16.7% | 25.0% | 1.06% | ⚠️ |
| XAUUSD | bearish | high | 40+ | 6 | 16.7% | 16.7% | 25.0% | 1.06% | ⚠️ |
| XAUUSD | bearish | high | 60+ | 6 | 16.7% | 16.7% | 25.0% | 1.06% | ⚠️ |
| GBPUSD | bearish | high | 25+ | 6 | 16.7% | 16.7% | 50.0% | -0.04% | ⚠️ |
| GBPUSD | bearish | high | 40+ | 6 | 16.7% | 16.7% | 50.0% | -0.04% | ⚠️ |
| GBPUSD | bearish | high | 60+ | 6 | 16.7% | 16.7% | 50.0% | -0.04% | ⚠️ |
| US100 | bearish | high | 25+ | 5 | 0.0% | 20.0% | 20.0% | 0.47% | ⚠️ |
| US100 | bearish | high | 40+ | 5 | 0.0% | 20.0% | 20.0% | 0.47% | ⚠️ |
| US100 | bearish | high | 60+ | 5 | 0.0% | 20.0% | 20.0% | 0.47% | ⚠️ |
| DJ30 | bearish | high | 25+ | 5 | 0.0% | 40.0% | 20.0% | -0.04% | ⚠️ |
| DJ30 | bearish | high | 40+ | 5 | 0.0% | 40.0% | 20.0% | -0.04% | ⚠️ |
| DJ30 | bearish | high | 60+ | 5 | 0.0% | 40.0% | 20.0% | -0.04% | ⚠️ |
| BTCUSD | bearish | high | 25+ | 2 | 50.0% | 50.0% | 50.0% | -0.66% | ⚠️ |
| BTCUSD | bearish | high | 40+ | 2 | 50.0% | 50.0% | 50.0% | -0.66% | ⚠️ |

### Development Set

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
| US100 | bearish | high | 25+ | 5 | 20.0% | 0.47% |
| US100 | bearish | high | 40+ | 5 | 20.0% | 0.47% |
| US100 | bearish | high | 60+ | 5 | 20.0% | 0.47% |
| DJ30 | bearish | high | 25+ | 5 | 40.0% | -0.04% |
| DJ30 | bearish | high | 40+ | 5 | 40.0% | -0.04% |
| DJ30 | bearish | high | 60+ | 5 | 40.0% | -0.04% |
| BTCUSD | bearish | high | 25+ | 2 | 50.0% | -0.66% |
| BTCUSD | bearish | high | 40+ | 2 | 50.0% | -0.66% |

### Out-of-Sample

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
| XAUUSD | bearish | high | 25+ | 6 | 16.7% | 1.06% |
| XAUUSD | bearish | high | 40+ | 6 | 16.7% | 1.06% |
| XAUUSD | bearish | high | 60+ | 6 | 16.7% | 1.06% |
| GBPUSD | bearish | high | 25+ | 6 | 16.7% | -0.04% |
| GBPUSD | bearish | high | 40+ | 6 | 16.7% | -0.04% |
| GBPUSD | bearish | high | 60+ | 6 | 16.7% | -0.04% |

---

## MAE Distribution

| Symbol | Direction | Threshold | Avg MAE 4h | Avg MAE 1d | Avg MAE 3d |
|--------|-----------|-----------|------------|------------|------------|
| XAUUSD | bearish | 25+ | -2.10% | -2.74% | -2.74% |
| XAUUSD | bearish | 40+ | -2.10% | -2.74% | -2.74% |
| XAUUSD | bearish | 60+ | -2.10% | -2.74% | -2.74% |
| GBPUSD | bearish | 25+ | -0.55% | -0.57% | -0.57% |
| GBPUSD | bearish | 40+ | -0.55% | -0.57% | -0.57% |
| GBPUSD | bearish | 60+ | -0.55% | -0.57% | -0.57% |
| US100 | bearish | 25+ | 0.00% | -0.86% | -0.86% |
| US100 | bearish | 40+ | 0.00% | -0.86% | -0.86% |
| US100 | bearish | 60+ | 0.00% | -0.86% | -0.86% |
| DJ30 | bearish | 25+ | 0.00% | -0.39% | -0.39% |
| DJ30 | bearish | 40+ | 0.00% | -0.39% | -0.39% |
| DJ30 | bearish | 60+ | 0.00% | -0.39% | -0.39% |

---

## Category Breakdown

### Employment Category Results

The employment category (NFP, Unemployment) has a known regime-dependence risk: strong jobs data can be bearish for equities when it increases rate-hike expectations, or bullish when it signals economic strength. This section breaks out employment-specific results.

| Symbol | Direction | Conviction | N | Hit 1d | Avg Ret 1d | Avg Emp Score |
|--------|-----------|------------|---|--------|------------|---------------|
| XAUUSD | bearish | high | 6 | 16.7% | 1.06% | -16.7 |
| XAUUSD | neutral | low | 1 | 0.0% | -1.94% | 20.0 |
| GBPUSD | bearish | high | 6 | 16.7% | -0.04% | -16.7 |
| GBPUSD | neutral | low | 1 | 0.0% | -0.58% | 20.0 |
| US100 | bearish | high | 5 | 20.0% | 0.47% | -20.0 |
| US100 | neutral | low | 7 | 0.0% | 0.94% | 15.7 |
| DJ30 | bearish | high | 5 | 40.0% | -0.04% | -20.0 |
| DJ30 | neutral | low | 9 | 0.0% | 0.22% | 15.6 |
| BTCUSD | bearish | high | 2 | 50.0% | -0.66% | -20.0 |
| BTCUSD | neutral | low | 2 | 0.0% | -0.14% | -5.0 |

**Interpretation**: A negative Avg Emp Score means employment events contributed bearishly to the bias. If employment/strong events consistently appear in bearish buckets for equities (US100/DJ30), this confirms the regime-dependence risk — strong jobs → rate-hike fears → bearish equities.

---

## Statistical Reliability

Buckets with N < 30 are flagged as statistically unreliable. Key findings should be validated with longer historical periods.

### Buckets with N >= 30

No buckets reached 30 samples. All results should be treated as preliminary.

---

## Out-of-Sample Comparison

Comparing development vs out-of-sample performance to detect potential overfitting:


---

## Recommendations

1. **Sample size is the primary limitation**: 30 days is insufficient for most statistical conclusions. Extend to 90+ days when API access allows.
2. **Calendar-only backtest**: RSS/news-driven categories (dollar strength, risk sentiment, geopolitical, crypto regulation, earnings) need forward validation only.
3. **Category caps may need tuning**: If certain categories consistently underperform, their caps could be adjusted (separate follow-up).
4. **No probability claims yet**: Results do not support converting bias scores to probability labels. Continue using directional language ("bullish/bearish alignment") rather than "X% probability."

---

*Report generated by MacroFlow backtesting framework.*
*Data sources: Twelve Data / Yahoo Finance (prices), ALFRED/FRED (historical economic data — vintage-correct).*
