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
