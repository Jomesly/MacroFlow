# MacroFlow Backtest Report

Generated: 2026-07-03T23:39:26.148Z

## Executive Summary

This report presents the results of backtesting MacroFlow's fundamental bias scoring engine against historical price data.

### Data Period
- **Start**: 2026-06-03
- **End**: 2026-07-01
- **Total records**: 190
- **Development set**: 133 records (first 70%)
- **Out-of-sample**: 57 records (last 30%)

### Known Limitations
- **FMP API blocked**: Historical economic calendar returns 403 on free tier. Synthetic calendar used (based on known release patterns).
- **Sample size**: 30 days of data is insufficient for statistical significance in most buckets. Results should be treated as directional indicators, not conclusive evidence.
- **RSS/news scoring not backtested**: Only calendar-driven categories (inflation, employment, GDP, PMI, retail_sales, Fed/BoE tone) are tested. Dollar strength, risk sentiment, geopolitical, crypto regulation, and earnings are validated forward-only.

---

## Baseline Comparison

| Metric | Value |
|--------|-------|
| Coin flip baseline | 50.0% |
| Actual win rate (1d) | 30.1% |

---

## Bucket Results

### All Data (Development + Out-of-Sample)

| Symbol | Direction | Conviction | Threshold | N | Hit 4h | Hit 1d | Hit 3d | Avg Ret 1d | Reliable |
|--------|-----------|------------|-----------|---|--------|--------|--------|------------|----------|
| XAUUSD | bullish | high | 25+ | 1 | 0.0% | 0.0% | 0.0% | -1.26% | ⚠️ |
| XAUUSD | bullish | high | 40+ | 1 | 0.0% | 0.0% | 0.0% | -1.26% | ⚠️ |
| XAUUSD | bullish | medium | 25+ | 23 | 34.8% | 21.7% | 42.9% | -0.47% | ⚠️ |
| XAUUSD | bullish | medium | 40+ | 15 | 40.0% | 20.0% | 7.7% | -1.18% | ⚠️ |
| XAUUSD | neutral | low | 25+ | 2 | 50.0% | 50.0% | 0.0% | -0.84% | ⚠️ |
| GBPUSD | bullish | high | 25+ | 10 | 90.0% | 30.0% | 50.0% | -0.27% | ⚠️ |
| GBPUSD | bullish | high | 40+ | 10 | 90.0% | 30.0% | 50.0% | -0.27% | ⚠️ |
| GBPUSD | bullish | high | 60+ | 8 | 87.5% | 25.0% | 50.0% | -0.32% | ⚠️ |
| GBPUSD | bullish | medium | 25+ | 21 | 28.6% | 55.0% | 93.8% | 0.04% | ⚠️ |
| GBPUSD | bullish | medium | 40+ | 15 | 13.3% | 53.3% | 100.0% | 0.10% | ⚠️ |
| GBPUSD | bullish | medium | 60+ | 4 | 0.0% | 100.0% | 100.0% | 0.22% | ⚠️ |
| GBPUSD | neutral | low | 25+ | 4 | 100.0% | 50.0% | 0.0% | -0.01% | ⚠️ |
| US100 | bearish | high | 25+ | 2 | 0.0% | 100.0% | 0.0% | -1.14% | ⚠️ |
| US100 | bearish | high | 40+ | 2 | 0.0% | 100.0% | 0.0% | -1.14% | ⚠️ |
| US100 | bearish | high | 60+ | 2 | 0.0% | 100.0% | 0.0% | -1.14% | ⚠️ |
| US100 | bearish | medium | 25+ | 22 | 0.0% | 22.7% | 40.9% | 0.69% | ⚠️ |
| US100 | bearish | medium | 40+ | 15 | 0.0% | 26.7% | 40.0% | 0.95% | ⚠️ |
| US100 | neutral | low | 25+ | 5 | 100.0% | 40.0% | 33.3% | -0.42% | ⚠️ |
| DJ30 | bearish | high | 25+ | 10 | 0.0% | 20.0% | 0.0% | 0.75% | ⚠️ |
| DJ30 | bearish | high | 40+ | 10 | 0.0% | 20.0% | 0.0% | 0.75% | ⚠️ |
| DJ30 | bearish | high | 60+ | 2 | 0.0% | 100.0% | 0.0% | -1.13% | ⚠️ |
| DJ30 | bearish | medium | 25+ | 18 | 0.0% | 27.8% | 72.2% | -0.14% | ⚠️ |
| DJ30 | bearish | medium | 40+ | 13 | 0.0% | 38.5% | 76.9% | -0.25% | ⚠️ |
| DJ30 | neutral | low | 25+ | 1 | 100.0% | 0.0% | 0.0% | -0.92% | ⚠️ |
| BTCUSD | bearish | medium | 25+ | 17 | 35.3% | 23.5% | 35.3% | 0.51% | ⚠️ |
| BTCUSD | bearish | medium | 40+ | 2 | 100.0% | 0.0% | 0.0% | 1.62% | ⚠️ |
| BTCUSD | neutral | low | 25+ | 3 | 33.3% | 33.3% | 0.0% | -0.69% | ⚠️ |

### Development Set

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
| XAUUSD | bullish | high | 25+ | 1 | 0.0% | -1.26% |
| XAUUSD | bullish | high | 40+ | 1 | 0.0% | -1.26% |
| XAUUSD | bullish | medium | 25+ | 17 | 17.6% | -0.43% |
| XAUUSD | bullish | medium | 40+ | 9 | 11.1% | -1.57% |
| XAUUSD | neutral | low | 25+ | 2 | 50.0% | -0.84% |
| GBPUSD | bullish | high | 25+ | 8 | 12.5% | -0.34% |
| GBPUSD | bullish | high | 40+ | 8 | 12.5% | -0.34% |
| GBPUSD | bullish | high | 60+ | 6 | 0.0% | -0.44% |
| GBPUSD | bullish | medium | 25+ | 12 | 33.3% | -0.02% |
| GBPUSD | bullish | medium | 40+ | 8 | 25.0% | 0.05% |
| GBPUSD | neutral | low | 25+ | 4 | 50.0% | -0.01% |
| US100 | bearish | high | 25+ | 2 | 100.0% | -1.14% |
| US100 | bearish | high | 40+ | 2 | 100.0% | -1.14% |
| US100 | bearish | high | 60+ | 2 | 100.0% | -1.14% |
| US100 | bearish | medium | 25+ | 21 | 23.8% | 0.72% |
| US100 | bearish | medium | 40+ | 15 | 26.7% | 0.95% |
| US100 | neutral | low | 25+ | 3 | 0.0% | -0.67% |
| DJ30 | bearish | high | 25+ | 10 | 20.0% | 0.75% |
| DJ30 | bearish | high | 40+ | 10 | 20.0% | 0.75% |
| DJ30 | bearish | high | 60+ | 2 | 100.0% | -1.13% |
| DJ30 | bearish | medium | 25+ | 15 | 33.3% | -0.16% |
| DJ30 | bearish | medium | 40+ | 12 | 41.7% | -0.27% |
| BTCUSD | bearish | medium | 25+ | 15 | 13.3% | 0.76% |
| BTCUSD | bearish | medium | 40+ | 2 | 0.0% | 1.62% |
| BTCUSD | neutral | low | 25+ | 2 | 0.0% | -1.06% |

### Out-of-Sample

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
| XAUUSD | bullish | medium | 25+ | 6 | 33.3% | -0.59% |
| XAUUSD | bullish | medium | 40+ | 6 | 33.3% | -0.59% |
| GBPUSD | bullish | high | 25+ | 2 | 100.0% | 0.04% |
| GBPUSD | bullish | high | 40+ | 2 | 100.0% | 0.04% |
| GBPUSD | bullish | high | 60+ | 2 | 100.0% | 0.04% |
| GBPUSD | bullish | medium | 25+ | 9 | 87.5% | 0.14% |
| GBPUSD | bullish | medium | 40+ | 7 | 85.7% | 0.16% |
| GBPUSD | bullish | medium | 60+ | 4 | 100.0% | 0.22% |
| US100 | bearish | medium | 25+ | 1 | 0.0% | 0.00% |
| US100 | neutral | low | 25+ | 2 | 100.0% | -0.04% |
| DJ30 | bearish | medium | 25+ | 3 | 0.0% | 0.00% |
| DJ30 | bearish | medium | 40+ | 1 | 0.0% | 0.00% |
| DJ30 | neutral | low | 25+ | 1 | 0.0% | -0.92% |
| BTCUSD | bearish | medium | 25+ | 2 | 100.0% | -1.40% |
| BTCUSD | neutral | low | 25+ | 1 | 100.0% | 0.05% |

---

## MAE Distribution

| Symbol | Direction | Threshold | Avg MAE 4h | Avg MAE 1d | Avg MAE 3d |
|--------|-----------|-----------|------------|------------|------------|
| XAUUSD | bullish | 25+ | -0.67% | -1.39% | -2.25% |
| XAUUSD | bullish | 40+ | -0.57% | -1.67% | -2.98% |
| GBPUSD | bullish | 25+ | -0.04% | -0.37% | -0.43% |
| GBPUSD | bullish | 40+ | -0.04% | -0.37% | -0.43% |
| GBPUSD | bullish | 60+ | -0.05% | -0.38% | -0.46% |
| GBPUSD | bullish | 25+ | -0.09% | -0.23% | -0.30% |
| GBPUSD | bullish | 40+ | -0.11% | -0.21% | -0.23% |
| US100 | bearish | 25+ | 0.00% | -0.74% | -1.15% |
| US100 | bearish | 40+ | 0.00% | -1.00% | -1.36% |
| US100 | neutral | 25+ | 0.00% | -1.04% | -2.54% |
| DJ30 | bearish | 25+ | 0.00% | -0.78% | -1.29% |
| DJ30 | bearish | 40+ | 0.00% | -0.78% | -1.29% |
| DJ30 | bearish | 25+ | 0.00% | -0.23% | -0.44% |
| DJ30 | bearish | 40+ | 0.00% | -0.26% | -0.38% |
| BTCUSD | bearish | 25+ | -0.65% | -1.67% | -3.37% |

---

## Statistical Reliability

Buckets with N < 30 are flagged as statistically unreliable. With only 30 days of data, most buckets will have small sample sizes. Key findings should be validated with longer historical periods.

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
*Data sources: Twelve Data (prices), FMP (calendar — synthetic fallback), Yahoo Finance (DXY/index fallback).*
