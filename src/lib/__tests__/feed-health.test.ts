import { describe, expect, it } from 'vitest';
import { failedFeeds } from '../feed-health';

describe('failed news feeds', () => {
  it('names only failed news feeds, sorted', () => {
    expect(failedFeeds({ feed_fxstreet: 'failed', feed_coindesk: 'ok', finnhub: 'failed', fred: 'failed', feed_yahoo_finance_fx: 'failed' }))
      .toEqual(['Finnhub', 'FXStreet', 'Yahoo Finance FX']);
  });
  it('treats a switched-off feed as not failed', () => expect(failedFeeds({ feed_fxstreet: 'empty' })).toEqual([]));
  it('handles a missing health report', () => expect(failedFeeds(null)).toEqual([]));
});
