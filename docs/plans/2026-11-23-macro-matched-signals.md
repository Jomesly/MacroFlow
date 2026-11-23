# Macro-Matched Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read news in the right direction, show how fresh every input is, issue buy/sell signals only when fresh news and the macro backdrop agree, and measure every signal so the words "High probability" appear only when real results earn them.

**Architecture:** Fix the headline classifier first, because wrong-direction reads are today's biggest error. Add freshness rules and display. Add a pure `gradeSignal()` that turns a forecast into an A signal, a B signal or no signal, using macro-match checks. An hourly Supabase-scheduled job records every A/B signal and resolves it four hours later against Yahoo hourly prices. A track-record API decides when a grade is "proven".

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Upstash Redis cache, Supabase Postgres (service-role client, pg_cron, pg_net, Vault), Yahoo Finance hourly bars via the existing `fetchYahooHourly`.

**Spec:** the Design section below, based on the 2026-11-23 live investigation.

**Relation to other docs:**
- Supersedes the measurement parts of `docs/hybridtrader-comparison-plan.md`: §0.1 (bias snapshots, used as a track record) and §2.4 (public track record page). Its journal "bias at entry" linking is out of scope here.
- Builds on the outcome rule in `docs/macro-probability.md` and the method in `docs/news-forecast.md`.

---

## Design

### What we found (live production, 2026-11-23 09:30 UTC)

- **Freshness mostly works.** Feeds refresh every 5 minutes. Headlines lose half their weight every 6 hours and drop out after 24 hours. But no page shows an article's publish time or age, so a faded 20-hour-old story looks current.
- **4 of the 7 scored headlines were misread:**
  - "Market rout kills 50bp December Fed rate hike bets" was read as Fed hawkish. It means the opposite.
  - An InvestingLive roundup ("Asia-Pacific market news") was read as Fed hawkish because one item quoted a JPMorgan strategist.
  - "Swedish bitcoin treasury **firm** lost 30 BTC" was read as Bitcoin bullish: "firm" (a company) matched "firm" (prices firming).
  - "France's growth forecast at risk of being downgraded" was read as a GDP beat.
- **The misreads changed the board.** The two misread Fed headlines were the top drivers on 10 of 12 markets. Reading them correctly flipped several markets, for example XAUUSD from −26 to +4 and US100 from −8 to +30.
- **Too little fresh news gets scored.** FXStreet, the busiest FX feed, fails on production but works locally. Only 8 of 30 recent FXStreet headlines get scored, and "X vs Y expected" data headlines are skipped.
- **Every lean becomes a buy/sell call, and nothing is measured.** Nothing records whether signals turned out right. `src/lib/probability/registry.json` is `null`. Past tests showed about 50–61% four-hour direction accuracy, with wide error ranges.

### Approach

1. **Read correctly.** Fix the misreads, skip roundups, and build a hand-labelled set of headlines that every future classifier change is checked against.
2. **Show freshness.** Show each driver's age and remaining weight, drop headlines older than 12 hours, and say clearly when there is no news from the last 6 hours.
3. **More fresh news.** Make feed outages visible, fix FXStreet, score "actual vs expected" headlines, and add Finnhub's forex and crypto news.
4. **Grade signals by macro match.** A signal needs fresh news and the macro backdrop pointing the same way, plus breadth, agreement and no high-impact release in the window. Anything else is a "lean", not a signal.
5. **Measure, then label.** Record every A/B signal hourly, resolve it after 4 hours, and show its track record. "High probability" is shown only for a grade whose measured results pass the gate below.

### Signal grades (fixed before any results are collected)

A signal exists only when the direction is not neutral and |score| ≥ 30. It is then checked against seven conditions:

| Check id | Passes when | Label shown |
|---|---|---|
| `fresh_news` | `forecast.latestNewsAt` is no more than 6 h before `asOf` and not in the future, and at least one supporting headline is no more than 6 h old | Fresh news (under 6 h) supports it |
| `macro_match` | `forecast.components.macro` exists, has the same sign as the score, and \|macro score\| ≥ 10 | Macro backdrop points the same way |
| `two_sources` | ≥ 2 distinct `sourceName` among supporting headlines | Two or more news sources agree |
| `agreement` | supporting \|scoreChange\| total ÷ all \|scoreChange\| total ≥ 0.70 | At least 70% of the evidence agrees |
| `market_confirms` | `alignment.marketConfirmation === 'confirming'` and `forecast.macroBiasScore` has the score's sign | Dollar and yield moves confirm |
| `no_event_risk` | no calendar event with `impact === 'high'`, `affects` containing the symbol, and time in (asOf, asOf + 4 h] | No high-impact release in the next 4 h |
| `healthy_inputs` | data is live, not stale, and no more than 5 min old (the route's existing `inputsHealthy`) | All data feeds are live |

- **A signal:** all seven checks pass.
- **B signal:** `fresh_news`, `macro_match`, `agreement`, `no_event_risk` and `healthy_inputs` pass, and exactly one of `two_sources` / `market_confirms` fails.
- **Otherwise:** "Lean only", with no buy/sell call.

Trade-signal mapping:

| Grade | Trade signal |
|---|---|
| A | `strong_buy` / `strong_sell` |
| B | `buy` / `sell` |
| none | `neutral` |

### What "High probability" means

**Outcome rule** (same as `docs/macro-probability.md`):
- Enter at the open of the first hourly bar strictly after the signal, within 1 hour.
- Exit at the close 4 contiguous hourly bars later.
- A flat result counts as a loss.
- Missing or non-contiguous bars make the signal void, and void signals are excluded.

**The gate.** For the current `FORECAST_VERSION`, a grade is **proven** when all of these hold:
- at least 100 resolved signals
- entries on at least 30 distinct days
- a 95% Wilson lower bound on the hit rate of at least 0.55. That means roughly a 65% hit rate at 100 signals, or 61% at 300.

Until then the dashboard says "Unproven · n/100 results". The gate may never be met for some grade; that would also be a useful answer.

Once collection starts, the thresholds are frozen. Any scoring change bumps `FORECAST_VERSION`, which starts a new track record.

## Global Constraints

- **Workspace:** work in a new worktree from `origin/main` (Task 0). Never work in the `macro-details` folder: it is based on `f19a1a2`, behind production, and holds older uncommitted forecast files.
- **Public repo:** commits must contain no secrets, tokens, project IDs, emails or personal paths. Scan the staged diff before every push.
- **Prices:** price action stays unscored (`docs/news-forecast.md`). Prices are used only to resolve signal outcomes.
- **Probability claims:** never derive a probability or "High probability" from rule scores. They come only from resolved outcomes that pass the gate.
- **Version:** `FORECAST_VERSION` becomes `'macro-factors-v4-4h-2026-11-23'` in Task 6. The track record counts only rows with the current version.
- **Verification:** every task passes `npm test`, `npx tsc --noEmit` and `npm run lint`.
- **Supabase and Vercel:** Supabase SQL is run by the user in the SQL Editor, or by Claude through a MacroFlow-scoped, expiring token sent through the secure field. Vercel env vars are set for Production only.
- **UI words, exactly:** "A signal", "B signal", "Lean only", "Unproven", "High probability", "Newest news".

## Review Focus

1. **Market closed:** a signal issued while the market is closed (weekend FX, after the equity cash close) must resolve as `void`, never `loss`. Covered by the Task 13 `resolveSignal` weekend test.
2. **Duplicate runs:** a duplicate scheduler run in the same hour, or a signal inside a still-running window, creates no second row. At most one signal per symbol per 5 hours. Covered by the Task 13 `selectNewSignals` tests.
3. **Feed outage:** a feed outage during a scheduled run records no new signals, but resolving continues. Covered by the Task 13 route test.
4. **Bad timestamps:** a headline with a future or missing time never counts as fresh news. Covered by the Task 10 future-timestamp test.
5. **Version change:** if the version is bumped while signals are open, old rows still resolve but are excluded from current stats. Covered by the Task 15 version test.

## File Map

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/api/classifier.ts` | Expectation shifts, roundups, advocacy, word sense, growth rule, release headlines | 1, 2, 3, 8 |
| `src/lib/__tests__/classifier-live-2026-11-23.test.ts` | Regression tests from live misreads | 1, 2, 3, 8 |
| `src/lib/__tests__/fixtures/headlines-golden.json`, `src/lib/__tests__/headlines-golden.test.ts`, `scripts/capture-headlines.ts` | Labelled headline set and precision gate | 4 |
| `src/lib/api/rss.ts` | Export the feed list; log failures | 4, 7 |
| `src/lib/freshness.ts` (+ `freshness.test.ts`) | Age labels, weights, cut-offs | 5, 6 |
| `src/lib/forecast.ts`, `src/lib/types.ts` | 12 h cut-off, `latestNewsAt`, version; `grade` on `BiasResult` | 6, 10 |
| `src/lib/market-factors.ts`, `src/components/market/{MarketAnalysis,FactorList,MarketDetailPage}.tsx`, `src/components/MarketCard.tsx` | Ages, grade badge and checklist, track record | 5, 6, 11, 15 |
| `src/lib/feed-health.ts` (+ test), `src/app/page.tsx` | Visible feed outages | 7 |
| `src/lib/api/finnhub.ts` (+ test) | Forex and crypto categories | 9 |
| `src/lib/signal-grade.ts` (+ test) | `gradeSignal`, `signalFromGrade` | 10 |
| `src/lib/bias-snapshot.ts`, `src/app/api/bias/route.ts` | One scoring path for the dashboard and the scheduled job | 11 |
| `supabase/signal-outcomes.sql`, `supabase/tests/signal-outcomes.sql`, `supabase/signal-schedule.sql` | Outcome table, hourly schedule | 12, 14 |
| `src/lib/signals/{types,record,resolve,track-record}.ts` (+ tests) | Record, resolve, summarize | 13, 15 |
| `src/app/api/signals/run/route.ts`, `src/app/api/signals/track-record/route.ts` | Scheduled job endpoint, public stats | 13, 15 |
| `docs/news-forecast.md` | User-facing method description | 11, 15 |

---

## Task 0: Workspace

- [ ] **Step 1:** Run `git fetch origin && git worktree add ../MacroFlow-signals -b feat/macro-matched-signals origin/main`
- [ ] **Step 2:** Copy this plan to `../MacroFlow-signals/docs/plans/2026-11-23-macro-matched-signals.md`. In the worktree, run `npm ci && npm test`. Expected: all tests pass. Record the count as the baseline.
- [ ] **Step 3:** Commit with `git add docs/plans/2026-11-23-macro-matched-signals.md && git commit -m "docs(plan): macro-matched signals"`

---

## Phase 1: Read headlines correctly

### Task 1: Expectation shifts in central-bank headlines

**Files:**
- Modify: `src/lib/api/classifier.ts`, the bank loop in `classifyNarratives` (about lines 343–367)
- Test: `src/lib/__tests__/classifier-live-2026-11-23.test.ts` (create)

**Interfaces:**
- Produces: `expectationShift(windowBeforeBank: string): 'reverse' | 'speculative' | null`, exported for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { articleText, classifyHeadline } from '../api/classifier';

const fed = (text: string) => classifyHeadline(text).filter(e => e.category === 'fed_tone');

describe('2026-11-23 live misreads: expectation shifts', () => {
  it('reads removed hike bets as dovish, medium impact', () => {
    const rows = fed(articleText('Market rout kills 50 basis points December Fed rate hike bets',
      'Traders have removed the possibility of a 50-basis-point December Fed rate hike after last week’s market rout.', 400));
    expect(rows.map(r => [r.value, r.impact])).toEqual([['dovish', 'medium']]);
  });
  it.each([
    ['Traders price out Fed rate cuts after hot jobs data', ['hawkish']],
    ['This Stock Market Selloff Could Block the Fed’s Rate Hikes', []],
    ['Fed rate hike bets climb after hot CPI', ['hawkish']],
    ['Stocks slash losses as Fed cuts rates', ['dovish']],
    ['Fed hikes rates by 25 basis points', ['hawkish']],
  ])('%s', (text, expected) => {
    expect(fed(text).map(r => r.value)).toEqual(expected);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/__tests__/classifier-live-2026-11-23.test.ts`. Expected: FAIL on the first three cases, which return hawkish, dovish and hawkish respectively.
- [ ] **Step 3: Implement `expectationShift`.** The window is the text before the bank-name match, within the same sentence, cut after the last `CLAUSE_BREAK` match and limited to the last 60 characters. Return:
  - `'speculative'` if the window matches `/\b(could|may|might|would)\b/i`
  - `'reverse'` if it matches `/\b(kill(?:s|ed|ing)?|remov\w*|price[sd]? out|pricing out|scrap\w*|abandon\w*|unwind\w*|slash\w*|wip(?:e|es|ed|ing) out|eras(?:e|es|ed|ing)|dash(?:es|ed|ing)?|block\w*)\b/i`
  - otherwise `null`

  In the bank loop, skip the clause on `'speculative'`. On `'reverse'`, flip hawkish↔dovish and use impact `'medium'`.
- [ ] **Step 4:** Run the test file, then `npm test`. Expected: the new file passes and no existing test regresses.
- [ ] **Step 5:** Commit `fix(classifier): read priced-out policy bets as the opposite move`

### Task 2: Roundups and advocacy are not policy signals

**Files:** Modify `src/lib/api/classifier.ts` (start of `classifyHeadline`). Test: append to `classifier-live-2026-11-23.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
describe('roundups and advocacy', () => {
  const digest = articleText('investingLive Asia-Pacific market news: US futures hold 2% bounce',
    "Waking up to green\nOCBC: AI rout becomes a growth shock as EM currencies take the dollar's strength\nJPMorgan's Kelly: tech correction overdue, stocks to bounce, Fed to hike once then pause", 400);
  it('scores nothing from a market roundup', () => expect(classifyHeadline(digest)).toEqual([]));
  it('scores nothing from "What are the main events for today?"', () =>
    expect(classifyHeadline('What are the main events for today?')).toEqual([]));
  it('ignores advocacy aimed at the Fed', () => expect(fed('Ackman urges Fed to cut rates')).toEqual([]));
  it('keeps a Fed official’s own words', () =>
    expect(fed('Fed’s Waller says a December hike is likely').map(r => r.value)).toEqual(['hawkish']));
});
```

- [ ] **Step 2:** Run the test file. Expected: FAIL on the roundup and advocacy cases.
- [ ] **Step 3: Implement.**
  - Add `ROUNDUP_TITLE = /\b(market news|news wrap|morning (?:wrap|briefing|call)|what are the main events|week ahead|live(?: blog| updates)?:|daily recap|top stories)\b/i`. `classifyHeadline` returns `[]` when it matches the first line or sentence of the text.
  - Add `ADVOCACY = /\b(urges?|urging|calls? on|press(?:es)?|pressures?|wants?)\b[^.]{0,20}\b(fed|federal reserve)\b/i`. When it matches, skip the `fed_tone` bank in `classifyNarratives`.
- [ ] **Step 4:** Run the test file, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(classifier): skip market roundups and advocacy aimed at the Fed`

### Task 3: Words with two meanings, and growth direction

**Files:** Modify `src/lib/api/classifier.ts`: the `UP` regex (about line 268) and the gdp rules (about lines 151–153). Test: append.

- [ ] **Step 1: Write the failing test**

```ts
const sentiment = (t: string) => classifyHeadline(t).filter(e => e.category === 'asset_sentiment').map(e => [e.symbol, e.value]);
const gdp = (t: string) => classifyHeadline(t).filter(e => e.category === 'gdp').map(e => e.value);
describe('word sense and growth direction', () => {
  it('does not read a company ("treasury firm") as prices firming', () =>
    expect(sentiment(articleText('This Swedish bitcoin treasury firm lost 30 BTC trading part of its own stack',
      'Stockholm-listed H100 moved a slice of its bitcoin into a derivatives book.', 400))).toEqual([]));
  it('still reads "Gold firmed" as bullish', () => expect(sentiment('Gold firmed after soft CPI')).toEqual([['XAUUSD', 'bullish']]));
  it('does not read a growth forecast at risk of downgrade as a beat', () =>
    expect(gdp("France's 2027 economic growth forecast of 1% at risk of being downgraded, minister says")).not.toContain('beat'));
  it('does not read "GDP growth slows" as a beat', () => expect(gdp('UK GDP growth slows to 0.1% in third quarter')).not.toContain('beat'));
  it('reads accelerating economic growth as a beat', () => expect(gdp('US economic growth accelerates to 3.1% in third quarter')).toContain('beat'));
});
```

- [ ] **Step 2:** Run. Expected: FAIL on "treasury firm", the France headline and "GDP growth slows".
- [ ] **Step 3: Implement.**
  - In `UP`, replace `firm\w*` with `firm(?:ed|ing|er)\b|firms? up\b`.
  - Remove the bare `growth` alternative from the `\bgdp\b` beat rule.
  - Replace the `\beconomic\b…(growth|expansion|strong)` rule with `/\beconomic (?:growth|expansion)\b.{0,30}\b(accelerat\w*|beat\w*|strong\w*|pick(?:s|ed)? up|rebound\w*|surg\w*)\b/i`.
- [ ] **Step 4:** Run the file, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(classifier): stop company and growth-forecast wording from creating bullish reads`

### Task 4: Labelled headline set and precision gate

**Files:**
- Create: `scripts/capture-headlines.ts`, `src/lib/__tests__/fixtures/headlines-golden.json`, `src/lib/__tests__/headlines-golden.test.ts`
- Modify: `src/lib/api/rss.ts`, exporting the existing `FEEDS` array as `RSS_FEEDS`

**Interfaces:**
- Fixture format: `{ "text": string, "expect": string[] }[]`. Each key is `category:value` or `category:value:SYMBOL`. An empty array means the headline should produce no signal.

- [ ] **Step 1: Write the capture script.** `npx tsx scripts/capture-headlines.ts` reads `RSS_FEEDS` (default URLs) and writes `.artifacts/headlines/<YYYY-MM-DD>.json`. For each item from the last 24 h it stores `source`, `title`, `snippet`, `publishedAt`, `url` and the current `classifyHeadline(articleText(title, snippet, 400))` keys.
- [ ] **Step 2: Build the fixture.** Include 60 entries: the 4 live misreads, their Task 1–3 variants, and 45 captured headlines with proposed labels.
- [ ] **Step 3 (checkpoint, user):** The user reviews and corrects the proposed labels. The label comes from a trader's reading, not from the current classifier output.
- [ ] **Step 4: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import cases from './fixtures/headlines-golden.json';
import { classifyHeadline } from '../api/classifier';

const key = (r: { category: string; value: string; symbol?: string }) => [r.category, r.value, r.symbol].filter(Boolean).join(':');
const channel = (k: string) => k.split(':').filter((_, i) => i !== 1).join(':');

describe('labelled headline set', () => {
  it('never reads a labelled channel in the opposite direction', () => {
    const wrong = cases.flatMap(c => classifyHeadline(c.text).map(key)
      .filter(k => c.expect.some(e => channel(e) === channel(k) && e !== k)).map(k => `${c.text} -> ${k}`));
    expect(wrong).toEqual([]);
  });
  it('keeps precision at or above 90%', () => {
    const hits = cases.flatMap(c => classifyHeadline(c.text).map(key).map(k => c.expect.includes(k)));
    expect(hits.filter(Boolean).length / hits.length).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 5:** Run `npx vitest run src/lib/__tests__/headlines-golden.test.ts`. If it fails, fix the classifier rules that produce the listed false or opposite reads. Never lower the 0.9 threshold, and never edit labels to match the code. Expected: PASS.
- [ ] **Step 6:** Commit `test(classifier): add labelled headline set with a precision gate`

---

## Phase 2: Show freshness

### Task 5: Driver age and remaining weight on the market page

**Files:**
- Create: `src/lib/freshness.ts`, `src/lib/__tests__/freshness.test.ts`
- Modify:
  - `src/lib/market-factors.ts`: add `timestamp?: string` to `MarketFactor`, set from `event.timestamp`
  - `src/components/market/MarketAnalysis.tsx`: the `DriverGroup` summary
  - `src/components/market/FactorList.tsx`: the detailed view
  - `src/components/market/MarketDetailPage.tsx`: pass `now` from `useMarketClock`

**Interfaces:**
- Produces:
  - `NEWS_HALF_LIFE_HOURS = 6`
  - `ageLabel(timestamp: string | undefined, now: string): string`
  - `weightLeftPercent(ageHours: number): number`
  - `ageHours(timestamp: string, now: string): number`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ageLabel, weightLeftPercent } from '../freshness';
const now = '2026-11-23T09:30:00.000Z';
describe('freshness labels', () => {
  it.each([
    ['2026-11-23T09:29:40.000Z', 'just now'], ['2026-11-23T08:45:00.000Z', '45 min ago'],
    ['2026-11-23T08:00:00.000Z', '1 h ago'], ['2026-11-22T09:30:00.000Z', '24 h ago'],
    ['2026-11-20T09:30:00.000Z', '3 d ago'], ['not-a-date', 'time unknown'], [undefined, 'time unknown'],
  ])('%s -> %s', (ts, label) => expect(ageLabel(ts, now)).toBe(label));
  it('halves every six hours', () => expect([0, 6, 12, 18].map(weightLeftPercent)).toEqual([100, 50, 25, 13]));
});
```

- [ ] **Step 2:** Run. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/freshness.ts`** with these labels:

  | Age | Label |
  |---|---|
  | under 60 s | "just now" |
  | under 60 min | "N min ago" |
  | under 48 h | "N h ago" (rounded down) |
  | older | "N d ago" |
  | invalid or missing | "time unknown" |

  Then update the market page:
  - Headline drivers show `<time dateTime={timestamp}>{ageLabel}</time> · counts {weightLeftPercent}%` in their summary.
  - Data drivers (trend, surprise, market) show only the age.
  - The detailed `FactorList` shows `· {ageLabel}` after the source.
- [ ] **Step 4:** Run `npm test`, then `npm run test:ui`. Expected: PASS. The existing market-page browser tests still pass.
- [ ] **Step 5:** Commit `feat(market): show each driver's age and remaining weight`

### Task 6: Fresh-news rules in the forecast

**Files:**
- Modify:
  - `src/lib/freshness.ts`
  - `src/lib/forecast.ts`: the weight line (about line 51) and the return object
  - `src/lib/types.ts`: add `forecast.latestNewsAt: string | null`
  - `src/components/MarketCard.tsx`
- Test: append to `src/lib/__tests__/forecast.test.ts` and `freshness.test.ts`.

**Interfaces:**
- Produces:
  - `MAX_HEADLINE_AGE_HOURS = 12`
  - `FRESH_NEWS_HOURS = 6`
  - `headlineWeight(ageHours: number, direct: boolean): number`
  - `BiasResult.forecast.latestNewsAt`
  - `FORECAST_VERSION = 'macro-factors-v4-4h-2026-11-23'`

- [ ] **Step 1: Write the failing tests**
  - `headlineWeight`:

    | Call | Expected |
    |---|---|
    | `headlineWeight(6, false)` | `0.4` |
    | `headlineWeight(0, true)` | `1` |
    | `headlineWeight(12, true)` | `0` |
    | `headlineWeight(-1, true)` | `0` |

  - In `forecast.test.ts`, using the existing event builders and `asOf`:
    - A single headline 13 h old is not in `events`, and `forecast.latestNewsAt` is `null`.
    - A single headline 7 h old is included, `latestNewsAt` equals its timestamp, and `limitations` contains `'No news in the last 6 hours; this read leans on older stories and the macro backdrop.'`.
    - A headline 1 h old does not add that limitation.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `headlineWeight` returns `(direct ? 1 : 0.8) * 0.5 ** (ageHours / 6)` when 0 ≤ age < 12, and 0 otherwise.
  - `forecast.ts` uses it instead of the inline formula, with `direct` true when `category === 'asset_sentiment'`.
  - `latestNewsAt` is the newest headline contribution's timestamp. Add the limitation when news rows exist but `latestNewsAt` is more than 6 h old.
  - Bump `FORECAST_VERSION`.
  - `MarketCard` shows "Newest news {ageLabel}", or "No news in 6 h".
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(forecast): drop headlines after 12 hours and flag reads without fresh news`

---

## Phase 3: More fresh news

### Task 7: Make feed outages visible, and fix FXStreet

**Files:**
- Modify: `src/lib/api/rss.ts` (the catch block), `src/app/page.tsx` (next to `SourceStatus`)
- Create: `src/lib/feed-health.ts`, `src/lib/__tests__/feed-health.test.ts`

**Interfaces:** Produces `failedFeeds(health: SourceHealth | null): string[]`.

- [ ] **Step 1: Write the failing test**
  - `failedFeeds({ feed_fxstreet: 'failed', feed_coindesk: 'ok', finnhub: 'failed', fred: 'failed' })` equals `['Finnhub', 'FXStreet']`. Only `finnhub` and `feed_*` keys count, and the result is sorted.
  - `failedFeeds(null)` equals `[]`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Turn `feed_x_y` into "X Y" in title case, with `fxstreet` special-cased to "FXStreet".
  - In the `rss.ts` catch block, log `console.warn('[rss] feed failed', feed.sourceName, error instanceof Error ? error.message : String(error))`.
  - In `page.tsx`, when the list is non-empty, show this notice: "News feed down: {names}. Fewer fresh headlines are scored."
- [ ] **Step 4:** Run `npm test` and `npm run test:ui`. Expected: PASS. Commit `feat(dashboard): show news feed outages`.
- [ ] **Step 5 (after deploy, ops):** Read the Vercel logs for `[rss] feed failed fxstreet`.
  - If they show HTTP 403 or 429, set `RSS_FXSTREET` to an empty value in Vercel Production. The feed then reports "empty", the notice clears, and FX coverage comes from Task 9.
  - If they show a bad URL, set `RSS_FXSTREET=https://www.fxstreet.com/rss/news`.
  - Either way, record the cause in `docs/news-forecast.md` under "Feed resilience".

### Task 8: Score "actual vs expected" headlines

**Files:** Modify `src/lib/api/classifier.ts`. Test: append to `classifier-live-2026-11-23.test.ts`.

**Interfaces:**
- Produces: `releaseHeadlineSignal(text: string): { category: EventCategory; value: string } | null`
- Consumes: the existing `classifyEconomicEvent(eventName, actual, forecast)`

- [ ] **Step 1: Write the failing test**

```ts
const keys = (t: string) => classifyHeadline(t).map(e => `${e.category}:${e.value}:${e.country ?? ''}`);
describe('release headlines', () => {
  it.each([
    ['Germany November flash manufacturing PMI 55.0 vs 54.0 expected', 'pmi:beat:EU'],
    ['France November flash services PMI 46.6 vs 47.5 expected. Prior 46.2', 'pmi:miss:EU'],
    ['Eurozone HCOB Manufacturing PMI arrives higher than expected at 52.9 in November', 'pmi:beat:EU'],
    ['US initial jobless claims 230K vs 220K expected', 'employment:weak:US'],
  ])('%s', (text, expected) => expect(keys(text)).toContain(expected));
});
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** Apply both patterns to the first sentence only:
  - **Pattern A:** `/^(?<name>.*?)\s(?<actual>-?\d+(?:\.\d+)?)[%kmb]?\s*(?:vs\.?|versus)\s*(?<estimate>-?\d+(?:\.\d+)?)[%kmb]?\s*(?:expected|exp\.?|est\.?|forecast|consensus)/i`
  - **Pattern B:** `/^(?<name>.*?)\s(?:arrives?|comes? in|prints?)?\s*(?<dir>higher|above|lower|below) than (?:expected|forecast|estimates?)/i`. Map higher/above to `(1, 0)` and lower/below to `(0, 1)`. Ignore better, worse, stronger and weaker: they are ambiguous for unemployment.

  Push the result with impact `'high'` for inflation and employment, `'medium'` otherwise, and country `inferCountry(text)`. Add its `category:value` to `seen` so generic rules don't duplicate it.
- [ ] **Step 4:** Run the file and `npm test`. Expected: PASS. Also run `npx vitest run src/lib/__tests__/headlines-golden.test.ts`; it still passes.
- [ ] **Step 5:** Commit `feat(classifier): score actual-versus-expected release headlines`

### Task 9: Finnhub forex and crypto news

**Files:** Modify `src/lib/api/finnhub.ts`. Create `src/lib/__tests__/finnhub.test.ts`.

**Interfaces:** Produces `FINNHUB_CATEGORIES = ['general', 'forex', 'crypto'] as const`. The cache key becomes `'finnhub_news_v10'`.

- [ ] **Step 1: Write the failing test**
  - Stub `FINNHUB_API_KEY` and `fetch` with `vi.stubGlobal`. Each category returns one article from the last hour. The `forex` and `general` articles share a URL; `crypto` has its own.
  - Assert `fetch` was called 3 times, with `category=general`, `category=forex` and `category=crypto`.
  - Assert the shared URL appears only once among the returned events' `url` values.
- [ ] **Step 2:** Run. Expected: FAIL (only 1 call).
- [ ] **Step 3: Implement.** Fetch all categories with `Promise.allSettled`, take 30 items per category, and dedupe by `url || id` before classifying. Return `[]` only when every category fails.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(news): add Finnhub forex and crypto news`

---

## Phase 4: Grade signals by macro match

### Task 10: `gradeSignal`

**Files:**
- Create: `src/lib/signal-grade.ts`, `src/lib/__tests__/signal-grade.test.ts`
- Modify: `src/lib/types.ts`, adding `grade?: SignalGradeResult` to `BiasResult`

**Interfaces:**
- Produces:
  - `type GradeCheckId = 'fresh_news' | 'macro_match' | 'two_sources' | 'agreement' | 'market_confirms' | 'no_event_risk' | 'healthy_inputs'`
  - `interface GradeCheck { id: GradeCheckId; passed: boolean; label: string }`
  - `interface SignalGradeResult { grade: 'A' | 'B' | 'none'; side: 'long' | 'short' | null; checks: GradeCheck[] }`
  - `gradeSignal(result: BiasResult, ctx: { asOf: string; calendar: CalendarEvent[]; inputsHealthy: boolean }): SignalGradeResult`
  - `signalFromGrade(grade: SignalGradeResult): TradeSignal`
- The rules and labels are the Signal grades table in the Design section. `side` is `null` whenever grade is `'none'`.

- [ ] **Step 1: Write the failing test.** The test builder `base()` returns this GBPUSD `BiasResult`:

  | Field | Value |
  |---|---|
  | `direction` / `biasScore` | `'bullish'` / `55` |
  | Headline events | +20 from Reuters, 1 h old; +15 from FXStreet, 2 h old |
  | Trend event | +5 |
  | `forecast.components.macro` | `{ score: 12, weight: 0.3 }` |
  | `forecast.latestNewsAt` | 1 h before `asOf` |
  | `forecast.macroBiasScore` | `20` |
  | `alignment.marketConfirmation` | `'confirming'` |

  Use `ctx = { asOf: '2026-11-23T09:00:00.000Z', calendar: [], inputsHealthy: true }`. Cases:

  | Case | Expected |
  |---|---|
  | base | `{ grade: 'A', side: 'long' }`, all 7 checks passed |
  | base mirrored to bearish | `{ grade: 'A', side: 'short' }` |
  | `marketConfirmation: 'flat'` | `B` |
  | `'flat'`, and both headlines from Reuters | `none` |
  | macro score −12 | `none` |
  | high-impact event 3 h later, `affects: ['GBPUSD']` | `none` |
  | same event 5 h later | `A` |
  | same event with `affects: ['USDJPY']` | `A` |
  | medium-impact event for GBPUSD 1 h later | `A` |
  | `latestNewsAt` and both headlines 7 h old | `none` |
  | `latestNewsAt: null` | `none` |
  | `latestNewsAt` and headlines 1 h in the future (Review Focus 4) | `none` |
  | extra opposing headline −20 (agreement 40/60) | `none` |
  | `biasScore: 29`, `direction: 'weakly_bullish'` | `{ grade: 'none', side: null }` |
  | `inputsHealthy: false` | `none` |

  Also test `signalFromGrade`:

  | Grade | Expected |
  |---|---|
  | A, long | `'strong_buy'` |
  | B, short | `'sell'` |
  | none | `'neutral'` |

- [ ] **Step 2:** Run. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement exactly as the Design table states, copying the check `label` strings verbatim.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(signals): grade signals by fresh news and macro match`

### Task 11: Grades in the API and UI

**Files:**
- Create: `src/lib/bias-snapshot.ts`
- Modify: `src/app/api/bias/route.ts`, `src/components/MarketCard.tsx`, `src/components/market/MarketDetailPage.tsx`, `docs/news-forecast.md`
- Test: append to `src/lib/__tests__/bias-route.test.ts`

**Interfaces:**
- Produces: `buildBiasSnapshot(symbol?: AssetSymbol): Promise<{ asOf: string; results: (BiasResult & { grade: SignalGradeResult })[]; meta: { source: DataSource; cachedAt: string; sourceHealth: SourceHealth; stale?: boolean; inputsHealthy: boolean; nextEvent: UpcomingEvent | null; dxy?: DxyContext } }>`
  - It moves the route's `getEvents` → `scoreMarketForecast` → `inputsHealthy` logic into this shared builder.
  - It passes `calendar: calendarEvidence?.events ?? []` to `gradeSignal` and sets each result's `signal` to `signalFromGrade(grade)`.
- `GET /api/bias` keeps `recordDailySnapshot` and `getHistory` in the route, not in the shared builder.

- [ ] **Step 1: Write the failing test.** With the existing route mocks, every result has `grade.checks.length === 7` and `signal === signalFromGrade(grade)`. With a stale snapshot, every signal is `'neutral'`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement the extraction and the UI.**
  - The card shows a badge: "A signal · Long", "B signal · Short" or "Lean only".
  - The detail page gets a "Signal checks" section that lists each check's label with a pass or fail icon and screen-reader text.
  - In `docs/news-forecast.md`, replace the Conviction section's statement that every lean issues buy/sell calls with the grade table, and link to this plan.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run test:ui`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(signals): issue buy/sell calls only for graded signals`

---

## Phase 5: Measure, then label

### Task 12: Signal outcome table

**Files:** Create `supabase/signal-outcomes.sql` and `supabase/tests/signal-outcomes.sql`.

- [ ] **Step 1: Write the test SQL.** Follow the style of `supabase/tests/journal-trade-symbols.sql`: `\set ON_ERROR_STOP on`, one transaction, rolled back at the end. It asserts that:
  - RLS is enabled
  - inserting `side = 'flat'` raises a check violation
  - inserting the same `id` twice with `on conflict do nothing` leaves one row
- [ ] **Step 2:** Run `psql "$LOCAL_TEST_DB_URL" -f supabase/tests/signal-outcomes.sql` against the disposable local database. Expected: an error saying the relation does not exist.
- [ ] **Step 3: Write the table SQL.** It is idempotent and safe to run in the SQL Editor:

```sql
create table if not exists signal_outcomes (
  id text primary key,                       -- SYMBOL:YYYY-MM-DDTHH (hour bucket of issued_at)
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  grade text not null check (grade in ('A', 'B')),
  forecast_version text not null,
  bias_score integer not null,
  issued_at timestamptz not null,
  checks jsonb not null,
  outcome text not null default 'open' check (outcome in ('open', 'win', 'loss', 'void')),
  entry_at timestamptz, exit_at timestamptz,
  entry_price double precision, exit_price double precision, return_bps double precision,
  created_at timestamptz not null default now()
);
create index if not exists signal_outcomes_open_idx on signal_outcomes (outcome, issued_at);
create index if not exists signal_outcomes_version_idx on signal_outcomes (forecast_version, outcome);
alter table signal_outcomes enable row level security;   -- server-only; service role bypasses RLS
```

- [ ] **Step 4:** Apply it to the local database and rerun the test. Expected: no errors.
- [ ] **Step 5:** Commit `feat(db): add signal outcome table`

### Task 13: Record, resolve and the scheduled endpoint

**Files:**
- Create: `src/lib/signals/types.ts`, `src/lib/signals/record.ts`, `src/lib/signals/resolve.ts`, `src/app/api/signals/run/route.ts`
- Tests: `src/lib/__tests__/signals-record.test.ts`, `signals-resolve.test.ts`, `signals-run-route.test.ts`

**Interfaces:**
- Consumes:
  - `buildBiasSnapshot` (Task 11)
  - `fetchYahooHourly(instrument, ticker, '5d')` and `IntradayBar`
  - `MARKET_REFERENCES[symbol].ticker`
  - `supabase` from `@/lib/supabase`
- Produces:
  - `interface SignalRow { id; symbol: AssetSymbol; side: 'long' | 'short'; grade: 'A' | 'B'; forecastVersion: string; biasScore: number; issuedAt: string; checks: GradeCheck[]; outcome: 'open' | 'win' | 'loss' | 'void'; entryAt: string | null; exitAt: string | null; entryPrice: number | null; exitPrice: number | null; returnBps: number | null }`
  - `selectNewSignals(results: (BiasResult & { grade: SignalGradeResult })[], recent: Pick<SignalRow, 'symbol' | 'issuedAt'>[], asOf: string, version: string): SignalRow[]`
  - `resolveSignal(row: Pick<SignalRow, 'issuedAt' | 'side'>, bars: IntradayBar[], now: string): Pick<SignalRow, 'outcome' | 'entryAt' | 'exitAt' | 'entryPrice' | 'exitPrice' | 'returnBps'>`
  - `POST /api/signals/run`, returning `{ recorded: number; resolved: number; voided: number }`

- [ ] **Step 1: Write the failing tests.**
  - **`selectNewSignals`:**
    - Only A/B grades become rows. For `asOf` `2026-11-23T09:05:00Z`, the id is `GBPUSD:2026-11-23T09`.
    - A symbol with a recent row issued less than 5 h before `asOf` is skipped (Review Focus 2).
    - Running twice with the same `asOf` produces the same ids.
  - **`resolveSignal`:** the signal is issued at `2026-11-23T10:05Z`. Hourly bars open at 11:00, 12:00, 13:00 and 14:00, with contiguous close times. The entry open is 1.2000 and the last close is 1.2030.

    | Case | Expected |
    |---|---|
    | long | `win`, `entryAt` `…T11:00`, `exitAt` `…T15:00`, `returnBps` `25` |
    | short | `loss`, `returnBps` `-25` |
    | last close equals the entry open | `loss`, `returnBps` `0` |
    | 13:00 bar missing, `now` `…T18:00` | `void` |
    | `now` `…T13:30` | `open` |
    | issued Saturday `2026-11-21T10:05Z`, no bars until Sunday 22:00, `now` Saturday 17:00 (Review Focus 1) | `void` |

  - **Route:** mock `@/lib/supabase` and `@/lib/bias-snapshot`, and set `SIGNALS_CRON_SECRET` to 64 hex characters.
    - No header returns 401, and a wrong secret returns 401.
    - A healthy snapshot with one A result inserts one row.
    - With `meta.inputsHealthy: false`, nothing is inserted, but open rows are still selected and resolved (Review Focus 3).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Entry and exit:** only bars with `closeTime ≤ now` count. The entry is the first bar with `openTime > issuedAt` and `openTime − issuedAt ≤ 1 h`. The exit needs 4 contiguous hourly bars.
  - **Return:** `returnBps = (exit / entry − 1) × 10 000 × (long ? 1 : −1)`, rounded to 2 decimals. The outcome is `win` only if this is greater than 0.
  - **Open vs void:** the outcome stays `open` until `now` reaches `entry + 4 h + 2 h grace`, or `issuedAt + 6 h` when there is no entry bar. After that, missing bars mean `void`.
  - **Route auth:** compare the bearer secret with `crypto.timingSafeEqual` on equal-length buffers, and reject when the env secret is shorter than 32 characters.
  - **Route recording:** load rows with `issued_at > asOf − 5 h` as `recent` for `selectNewSignals`. Insert with `upsert(rows, { onConflict: 'id', ignoreDuplicates: true })`, and only when `meta.inputsHealthy`.
  - **Route resolving:** load rows with `outcome = 'open'` and `issued_at < now − 5 h`, fetch prices once per symbol, and update the resolved rows.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(signals): record graded signals hourly and resolve them after four hours`

### Task 14: Schedule it and deploy (ops; needs the user)

**Files:** Create `supabase/signal-schedule.sql`, mirroring `supabase/journal-screenshot-schedule.sql`:
- Vault name `signals_run_url`, which must match `https://%/api/signals/run`
- Vault name `signals_run_secret`, at least 32 characters
- Job: `cron.schedule('macroflow-signals', '5 * * * *', …net.http_post(url, Bearer secret, '{}')…)`

- [ ] **Step 1:** Commit `feat(db): schedule the hourly signal job`. Scan the diff for secrets, then merge to `main` with a fast-forward push. Vercel deploys `main`.
- [ ] **Step 2 (user, or Claude with a scoped token):**
  - Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never paste it in chat.
  - Set it as `SIGNALS_CRON_SECRET` in Vercel Production, then redeploy.
  - Store the same secret and the URL in Supabase Vault.
  - Run `supabase/signal-outcomes.sql`, then `supabase/signal-schedule.sql`.
- [ ] **Step 3: Verify.**
  - `select jobname, schedule from cron.job where jobname = 'macroflow-signals'` returns one row.
  - After the next :05, `select status_code from net._http_response order by created desc limit 3` includes `200`.
  - `select count(*), max(created_at) from signal_outcomes` runs. Zero rows is fine if no market has graded A or B yet.
  - After 6 hours, if any signals were recorded, at least one row is no longer `open`.

### Task 15: Track record and the "High probability" label

**Files:**
- Create: `src/lib/signals/track-record.ts`, `src/app/api/signals/track-record/route.ts`, `src/lib/__tests__/signals-track-record.test.ts`
- Modify: `MarketCard.tsx`, `MarketDetailPage.tsx`, `src/app/page.tsx` (fetch once, pass to cards), `docs/news-forecast.md`

**Interfaces:**
- Consumes: `wilson(wins, n)` from `src/lib/probability/model.ts`
- Produces:
  - `PROVEN_MIN_SIGNALS = 100`, `PROVEN_MIN_DAYS = 30`, `PROVEN_MIN_LOWER_BOUND = 0.55`
  - `interface GradeStats { n: number; wins: number; hitRate: number | null; interval95: [number, number] | null; days: number; avgReturnBps: number | null; proven: boolean }`
  - `interface TrackRecord { version: string; overall: Record<'A' | 'B', GradeStats>; bySymbol: Partial<Record<AssetSymbol, Record<'A' | 'B', GradeStats>>> }`
  - `summarizeTrackRecord(rows: SignalRow[], version: string): TrackRecord`
  - `gradeLabel(grade: SignalGradeResult, stats: GradeStats | undefined): { badge: string; detail: string }`
  - `GET /api/signals/track-record`, returning the current version's `TrackRecord` with `Cache-Control: public, s-maxage=300`

- [ ] **Step 1: Write the failing tests.**
  - **`summarizeTrackRecord`:**

    | Rows | Expected |
    |---|---|
    | none | `overall.A`: `n` 0, `hitRate` null, `proven` false |
    | 100 A rows, 70 wins, 30 distinct entry days | `proven` true, `interval95[0]` ≈ 0.604 (`toBeCloseTo(0.604, 3)`) |
    | 100 rows, 60 wins, 30 days | `proven` false (lower bound ≈ 0.502) |
    | 120 rows, 80 wins, 29 days | `proven` false |
    | rows with another `forecastVersion`, or `open`/`void` rows | ignored (Review Focus 5) |

  - **`gradeLabel`:**
    - Proven A long at 64% of 180: the badge is "A signal · Long" and the detail is "High probability · right 64% of the time over 4 h (all markets, n=180)".
    - Unproven at n=23: the detail is "Unproven · 23/100 results".
    - Grade none: the badge is "Lean only" and the detail is "".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `days` counts distinct `entryAt` dates.
  - The card's detail line uses the `overall` stats for its grade.
  - The detail page gets a "Track record" section. Per grade it shows results, hit rate, 95% range, average move in bps, and this market's own row.
  - The words "High probability" appear nowhere else in the UI.
  - Update `docs/news-forecast.md` with the outcome rule and the gate.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run test:ui`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(signals): show the measured track record and earn the high-probability label`

---

## Rollout order and what to expect

1. **Ship Phase 1 (Tasks 1–4) first.** Today's board is driven by misreads, so this fixes the most visible problem.
2. **Ship Phases 2 and 3 next.** They are independent of each other and can ship separately.
3. **Ship Phases 4 and 5 together.** A grade without measurement is still a guess, and Task 14 starts the clock.
4. **Expect few A signals.** Maybe a few a week across 12 markets, with B signals more common. The first "High probability" label can appear no sooner than 30 days after Task 14, and only if the results earn it.
5. **Don't loosen the gate.** If a grade stays below the gate after about 300 results, keep it "Unproven" and improve the inputs under a new `FORECAST_VERSION`.
