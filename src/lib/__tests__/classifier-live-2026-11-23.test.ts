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

describe('found in local testing on 2026-11-23', () => {
  it('does not read a bank’s rate forecast as the Fed itself', () =>
    expect(fed(articleText('Federal Reserve: Consecutive hikes and sticky inflation – TD Securities',
      'TD Securities economists Oscar Munoz and Eli Nir expect the Federal Reserve to deliver three consecutive rate hikes starting in December, with scope for further tightening later in the cycle.', 400))).toEqual([]));
  it.each(['Reuters', 'Bloomberg', 'CNBC'])('keeps Fed news credited to a news agency (– %s)', agency =>
    expect(fed(`Fed hikes rates by 25 basis points – ${agency}`).map(r => r.value)).toEqual(['hawkish']));
  it('does not read a generic hike forecast by economists as Fed tone', () =>
    expect(fed('Economists expect two more rate hikes next year')).toEqual([]));
  it('does not read the S&P PMI data provider as the S&P 500', () =>
    expect(sentiment(articleText('British Pound pulls back from session highs following soft UK Flash PMIs',
      "The British Pound (GBP) trims earlier gains against the US Dollar (USD) on Monday, as preliminary UK S&P Purchasing Managers' Index (PMI) figures fell short in November.", 400))
      .filter(([symbol]) => symbol === 'US500')).toEqual([]));
  it('still reads the S&P 500 itself', () => expect(sentiment('S&P 500 falls as yields climb')).toContainEqual(['US500', 'bearish']));
  it('strips markup from article text', () =>
    expect(articleText('UK PMI 52.0 vs 53.0 expected', '<ul><li style="vertical-align: baseline; margin: 0">Prior 52.8</li></ul>')).toBe('UK PMI 52.0 vs 53.0 expected. Prior 52.8'));
});

const keys = (t: string) => classifyHeadline(t).map(e => `${e.category}:${e.value}:${e.country ?? ''}`);
describe('release headlines', () => {
  it.each([
    ['Germany November flash manufacturing PMI 55.0 vs 54.0 expected', 'pmi:beat:EU'],
    ['France November flash services PMI 46.6 vs 47.5 expected. Prior 46.2', 'pmi:miss:EU'],
    ['Eurozone HCOB Manufacturing PMI arrives higher than expected at 52.9 in November', 'pmi:beat:EU'],
    ['US initial jobless claims 230K vs 220K expected', 'employment:weak:US'],
  ])('%s', (text, expected) => expect(keys(text)).toContain(expected));
});
