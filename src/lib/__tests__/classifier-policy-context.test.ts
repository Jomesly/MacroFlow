import { describe, expect, it } from 'vitest';
import { articleText, classifyHeadline } from '../api/classifier';

const policy = (text: string) => classifyHeadline(text)
  .filter(row => row.category.endsWith('_tone'))
  .map(row => `${row.category}:${row.value}`);

describe('policy evidence stays in the sentence that asserts it', () => {
  it('does not turn the live Bitcoin inflation preview into Fed policy', () => {
    const text = 'BTC price gains 12% from $55K: Three things to know in Bitcoin this week. Nasdaq-100 futures rose 3.1% before Monday’s open, while Wednesday’s US inflation report could shape expectations for a December rate hike.';
    expect(policy(text)).toEqual([]);
    expect(classifyHeadline(text)).toContainEqual(expect.objectContaining({ category: 'asset_sentiment', symbol: 'BTCUSD', value: 'bullish' }));
  });

  it('does not turn the live Ethereum outlook into a fresh Fed action', () => {
    const text = 'Ethereum rebounds, but has the crypto market selloff run its course? Last week was a brutal one for Ethereum and the crypto market in general as the global stock market rout depressed the risk sentiment further and increased growth concerns. The market is likely expecting a slowdown in the economy in the next 6-12 months caused by Fed tightening, prolonged US-Iran stalemate, limited fiscal impulse and AI bubble burst. This is a very negative macro backdrop for risk';
    expect(policy(text)).toEqual([]);
  });

  it.each([
    'Wednesday’s inflation report could shape expectations for a December rate hike',
    'Investors await Friday’s jobs report to assess the possibility of a rate cut',
    'Next week’s inflation data may determine the chances of a Fed hike',
    'The market is likely expecting a slowdown caused by Fed tightening',
    'Last month’s Fed hike weighed on stocks',
    'Fed tightening last year explains the recession forecast',
  ])('does not score an unasserted or retrospective policy reference: %s', text => {
    expect(policy(text)).toEqual([]);
  });

  it.each([
    ['Fed hikes rates by 25 basis points', 'fed_tone:hawkish'],
    ['Fed signals rate hike as inflation persists', 'fed_tone:hawkish'],
    ['Fed’s Waller says a December hike is likely', 'fed_tone:hawkish'],
    ['ECB cuts rates as growth stalls', 'ecb_tone:dovish'],
    ['Market rout kills 50 basis points December Fed rate hike bets', 'fed_tone:dovish'],
    ['Traders price out Fed rate cuts after hot jobs data', 'fed_tone:hawkish'],
    ['Fed rate hike bets climb after hot CPI', 'fed_tone:hawkish'],
    ['Investors pare back aggressive Fed tightening expectations', 'fed_tone:dovish'],
    ['Market expectations of a large Federal Reserve rate hike in December are ebbing', 'fed_tone:dovish'],
  ])('preserves an asserted decision, official guidance or repricing: %s', (text, expected) => {
    expect(policy(text)).toEqual([expected]);
  });

  it('keeps a policy announcement when a later sentence previews upcoming data', () => {
    expect(policy(articleText('Fed cuts rates by 25 basis points',
      'Wednesday’s inflation report could shape expectations for a December rate hike.'))).toEqual(['fed_tone:dovish']);
  });

  it('keeps an announcement when a later sentence quotes an economist forecast', () => {
    expect(policy(articleText('Fed hikes rates by 25 basis points',
      'Economists expect a rate cut next year.'))).toEqual(['fed_tone:hawkish']);
  });

  it('keeps new repricing when an earlier sentence mentions historical policy', () => {
    expect(policy('Last month’s Fed hike weighed on stocks. Traders price out Fed rate cuts after hot jobs data.')).toEqual(['fed_tone:hawkish']);
  });
});
