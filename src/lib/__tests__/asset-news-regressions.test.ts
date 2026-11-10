import { describe, expect, it } from 'vitest';
import { classifyHeadline } from '../api/classifier';
import { scoreMacroAlignment } from '../alignment';
import { unknownContext } from '../macro-context';
import type { MacroEvent } from '../types';

const signals = (text: string, category: string) => classifyHeadline(text).filter(row => row.category === category).map(row => row.value);
const asOf = '2026-11-10T15:27:33.555Z';
const capturedCpi = 'Breaking: US Consumer Price Index rises 0.4% MoM in October vs. 0.3% expected Monthly inflation in the United States, as measured by the change in the Consumer Price Index (CPI), was 0.4% in October, the US Bureau of Labor Statistics (BLS) reported on Tuesday.';
const capturedBanks = 'Will stablecoins survive once the banks catch up? As crypto firms and banks converge, it is fair to ask what lasting advantage stablecoins have, argues Alessandro Hatami, founder of Pacemakers and former COO of Digital Banking at Lloyds Banking Group.';
const events = (text: string): MacroEvent[] => classifyHeadline(text).map((row, i) => ({ ...row, id: `article:${i}`, timestamp: asOf, evidenceType: 'headline' }));

describe('captured GBPUSD and Bitcoin input errors', () => {
  it('does not translate a CPI index rise into bullish equity risk appetite', () => {
    expect(signals(capturedCpi, 'risk_sentiment')).toEqual([]);
    for (const symbol of ['GBPUSD', 'BTCUSD'] as const) {
      expect(scoreMacroAlignment(events(capturedCpi), unknownContext(asOf), asOf, symbol)[0].biasScore).toBe(0);
    }
  });
  it('does not translate banks and banking into a crypto ban', () => {
    expect(signals(capturedBanks, 'crypto_regulation')).toEqual([]);
    expect(scoreMacroAlignment(events(capturedBanks), unknownContext(asOf), asOf, 'BTCUSD')[0].biasScore).toBe(0);
  });
  it.each(['US dollar index rises', 'Consumer confidence index falls', 'Producer price index climbs', 'Manufacturing index drops'])(
    'requires an equity subject for index risk sentiment: %s', text => expect(signals(text, 'risk_sentiment')).toEqual([]));
  it.each(['S&P 500 index rises', 'Nasdaq index rallies', 'Dow Jones index falls', 'US stock index drops'])(
    'preserves named equity moves: %s', text => expect(signals(text, 'risk_sentiment')).not.toEqual([]));
});

describe('GBPUSD policy attribution', () => {
  it.each(['Bank of England cuts its inflation forecast', 'BoE lowers growth forecasts', 'Bank of England cuts its 2027 GDP projection'])(
    'does not score a forecast revision as a rate action: %s', text => {
      expect(signals(text, 'boe_tone')).toEqual([]);
      expect(scoreMacroAlignment(events(text), unknownContext(asOf), asOf, 'GBPUSD')[0].biasScore).toBe(0);
    });
  it.each(['Bank of England cuts interest rates', 'BoE cuts rates and lowers its inflation forecast', 'Bank of England turns dovish', 'BoE signals a rate cut'])(
    'preserves actual or explicit dovish policy language: %s', text => expect(signals(text, 'boe_tone')).toEqual(['dovish']));
});

describe('Bitcoin regulatory attribution', () => {
  it('does not elevate generic regulatory evidence to high impact', () => {
    expect(classifyHeadline('Regulatory clearance granted for digital assets').find(row => row.category === 'crypto_regulation')?.impact).toBe('medium');
  });
  it.each(['SEC approves new stock exchange rules', 'Regulatory clearance for a new cancer treatment',
    'SEC has not approved a Bitcoin ETF', 'Bitcoin ETF approval expected next month', 'SEC may approve a Bitcoin ETF',
    'SEC has not banned crypto', 'Crypto banks expand services', 'SEC approves stock exchange rules. Bitcoin trades sideways.'])(
    'does not award regulation points without a relevant factual action: %s', text => expect(signals(text, 'crypto_regulation')).toEqual([]));
  it.each(['SEC approves spot Bitcoin ETF', 'SEC approved spot Bitcoin ETF', 'SEC allows a Bitcoin ETF', 'Bitcoin ETF approval granted by SEC'])(
    'preserves confirmed approval: %s', text => expect(signals(text, 'crypto_regulation')).toEqual(['positive']));
  it.each(['SEC denies Bitcoin ETF approval', 'SEC denied approval for a Bitcoin ETF', 'SEC rejects a Bitcoin ETF', 'China bans crypto trading', 'Crypto trading banned by regulators'])(
    'recognizes negative regulation without reading approval as positive: %s', text => expect(signals(text, 'crypto_regulation')).toEqual(['negative']));
});
