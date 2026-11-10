import { describe, expect, it } from 'vitest';
import { classifyHeadline } from '../api/classifier';
import { scoreMacroAlignment } from '../alignment';
import { buildMacroInputs } from '../macro-context';
import { contextFixture } from './fixtures/macro';
import type { MacroEvent } from '../types';

describe('probability input relevance', () => {
  it.each(['Gold prices ease as focus shifts to US inflation data',
    'Asian stocks climb as oil prices slide ahead of US CPI - Reuters Asian stocks climb as oil prices slide ahead of US CPI'])('does not infer inflation from unrelated price movement: %s', text => {
    expect(classifyHeadline(text).filter(e=>e.category==='inflation')).toEqual([]);
  });
  it('keeps direct inflation assertions while excluding company moves from broad risk', () => {
    expect(classifyHeadline('US CPI rises 0.3%').some(e=>e.category==='inflation'&&e.value==='high')).toBe(true);
    expect(classifyHeadline('Nvidia stock falls as Wall Street assesses an investigation').some(e=>e.category==='risk_sentiment')).toBe(false);
    expect(classifyHeadline('Nvidia shares plunge after company investigation').some(e=>e.category==='risk_sentiment')).toBe(false);
    expect(classifyHeadline('Wall Street falls as stocks plunge').some(e=>e.category==='risk_sentiment')).toBe(true);
  });
  it('requires structured economic evidence and distinguishes flat from opposing observations', () => {
    const now='2026-11-10T12:00:00.000Z';
    const {context}=buildMacroInputs(contextFixture(),now);
    const inflation:MacroEvent={id:'cpi',category:'inflation',value:'low',evidenceType:'headline',country:'US',title:'CPI',description:'CPI',timestamp:now,impact:'high'};
    const market:MacroEvent={...inflation,id:'dxy',category:'dollar_strength',value:'neutral',evidenceType:'market'};
    expect(scoreMacroAlignment([inflation,market],context,now,'XAUUSD')[0].events).toHaveLength(0);
    const structured={...inflation,evidenceType:'surprise' as const};
    const flat=scoreMacroAlignment([structured,market],context,now,'XAUUSD')[0];
    expect(flat.alignment).toMatchObject({status:'unconfirmed',marketConfirmation:'flat'});
    expect(flat.signal).toBe('neutral');
  });
  it.each(['Medios shares fall 4% as nine-month EBITDA declines despite revenue growth',
    'Acme shares plunge after earnings', 'Acme stock falls after earnings'])('excludes company-specific moves without a company name list: %s', text => {
    expect(classifyHeadline(text).some(event => event.category === 'risk_sentiment')).toBe(false);
  });
});
