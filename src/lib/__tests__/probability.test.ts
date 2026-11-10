import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMacroInputs, MODEL_VERSION } from '../macro-context';
import { scoreMacroAlignment } from '../alignment';
import { contextFixture } from './fixtures/macro';
import { estimateProbability, probabilityKey, TARGET, type ProbabilityModel } from '../probability/model';
import { fitProbabilityModel, type ProbabilityObservation } from '../probability/calibration';
import { compareProbabilities, currentProbabilityReading, displayedProbability, probabilityText } from '../probability/presentation';
import type { MacroEvent } from '../types';

const now = '2026-11-10T12:00:00.000Z';
const health = { source: 'live', sourceHealth: { fred: 'ok' as const, economic_calendar: 'empty' as const } };
const context = buildMacroInputs(contextFixture(), now).context;
const event = (category: MacroEvent['category'], value: string, evidenceType: MacroEvent['evidenceType']): MacroEvent =>
  ({ id: category, category, value, evidenceType, title: value, description: value, country: 'US', timestamp: now, impact: 'high' });
function reading() {
  return scoreMacroAlignment([event('fed_tone','dovish','headline'),event('inflation','low','surprise'),event('dollar_strength','weak','market')],structuredClone(context),now,'XAUUSD')[0];
}
function artifact(): ProbabilityModel {
  return { schemaVersion: 1, method: 'empirical-buckets-v1', inputModelVersion: MODEL_VERSION, inputProfile: 'prospective-live', target: TARGET,
    dataSha256: 'a'.repeat(64), createdAt: '2026-11-09T00:00:00.000Z', calibrationEnd: '2026-09-30T20:00:00.000Z',
    holdoutStart: '2026-10-01T00:00:00.000Z', holdoutEnd: '2026-11-08T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z',
    groups: [{ key: probabilityKey(reading()), calibration: { n:200,wins:140,days:45 }, holdout:{n:100,wins:70,days:30}, baseline:{n:1000,wins:500,days:90} }] };
}

describe('empirical four-hour probability', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); });
  afterEach(() => vi.useRealTimers());
  it('never converts points to a probability or supplies a default 50%', () => {
    const r = { ...reading(), biasScore:98 };
    expect(estimateProbability(r,null,now,health)).toMatchObject({status:'unavailable',value:null,interval95:null});
    expect(r.biasPercent).toBeNull();
    expect(probabilityText(r)).toBe('—');
  });
  it('estimates from calibration outcomes, independently of the later validation count', () => {
    const model=artifact();
    const p=estimateProbability(reading(),model,now,health);
    expect(p).toMatchObject({status:'validated',value:141/202,calibrationSamples:200,validationSamples:100,direction:'up'});
    model.groups[0].holdout.wins=73;
    expect(estimateProbability(reading(),model,now,health).value).toBe(p.value);
    expect(p.interval95![0]).toBeLessThan(p.value!);
    expect(p.interval95![1]).toBeGreaterThan(p.value!);
  });
  it.each(['small','short','miscalibrated','no-skill','expired','future','wrong-version','duplicates','bad-counts'] as const)('withholds an unsafe model: %s', issue => {
    const model=artifact();
    if(issue==='small') model.groups[0].holdout.n=99;
    if(issue==='short') model.groups[0].holdout.days=29;
    if(issue==='miscalibrated') model.groups[0].holdout.wins=40;
    if(issue==='no-skill') model.groups[0].baseline.wins=700;
    if(issue==='expired') model.expiresAt='2026-11-10T00:00:00.000Z';
    if(issue==='future') model.createdAt='2026-11-11T00:00:00.000Z';
    if(issue==='wrong-version') model.inputModelVersion='previous';
    if(issue==='duplicates') model.groups.push(model.groups[0]);
    if(issue==='bad-counts') model.groups[0].calibration.wins=201;
    expect(estimateProbability(reading(),model,now,health).value).toBeNull();
  });
  it('does not extrapolate to another asset, regime, direction or evidence profile', () => {
    const r=reading();
    for(const other of [{...r,symbol:'EURUSD' as const},{...r,direction:'bearish' as const}, {...r,events:r.events.filter(e=>e.evidenceType!=='headline')},
      {...r,alignment:{...r.alignment,context:{...r.alignment.context,regime:'mixed' as const}}}]) {
      expect(estimateProbability(other,artifact(),now,health).value).toBeNull();
    }
  });
  it('fails closed on stale readings, missing context and failed sources', () => {
    expect(estimateProbability(reading(),artifact(),now,{...health,source:'baseline'}).value).toBeNull();
    expect(estimateProbability(reading(),artifact(),now,{...health,stale:true}).value).toBeNull();
    expect(estimateProbability(reading(),artifact(),now,{...health,sourceHealth:{fred:'failed'}}).value).toBeNull();
    expect(estimateProbability({...reading(),lastUpdated:'2026-11-10T11:00:00.000Z'},artifact(),now,health).value).toBeNull();
    const r=reading();r.alignment.context.complete=false;
    expect(estimateProbability(r,artifact(),now,health).value).toBeNull();
  });
  it('sorts unsigned probabilities symmetrically and leaves unavailable readings last', () => {
    const r=reading(), p=estimateProbability(r,artifact(),now,health);
    const bull={...r,symbol:'XAUUSD' as const,probability:{...p,value:0.6}};
    const bear={...r,symbol:'US100' as const,direction:'bearish' as const,probability:{...p,direction:'down' as const,value:0.7}};
    const unavailable={...r,symbol:'BTCUSD' as const,biasScore:100};
    expect([unavailable,bull,bear].sort(compareProbabilities).map(r=>r.symbol)).toEqual(['US100','XAUUSD','BTCUSD']);
    expect(probabilityText(bear)).toBe('70.0%');
    expect(displayedProbability({...bear,probability:{...p,value:1.3}})).toBeNull();
    expect(displayedProbability({...bear,probability:{...p,value:0.7}})).toBeNull();
  });
  it('expires from the original reading time and suppresses failed refreshes', () => {
    const r = { ...reading(), lastUpdated: '2026-11-10T11:58:00.000Z' };
    const probability = estimateProbability(r, artifact(), now, health);
    expect(probability.validUntil).toBe('2026-11-10T12:03:00.000Z');
    const result = { ...r, probability };
    expect(displayedProbability(result, Date.parse(probability.validUntil!))).toBeNull();
    expect(currentProbabilityReading(result, true, Date.parse(now)).probability?.value).toBeNull();
  });
});

describe('chronological calibration construction', () => {
  function row(at:string, end:string, success=true): ProbabilityObservation {
    return {inputModelVersion:MODEL_VERSION,inputProfile:'prospective-live',symbol:'XAUUSD',side:'up',key:'gold-up',timestamp:at,
      entryTime:new Date(Date.parse(end)-4*3_600_000).toISOString(),exitTime:end,success};
  }
  it('purges boundary outcomes, rejects future labels and selects non-overlapping trades', () => {
    const records=[row('2026-09-30T01:00:00.000Z','2026-09-30T06:00:00.000Z'),
      row('2026-09-30T02:00:00.000Z','2026-09-30T07:00:00.000Z'),
      row('2026-09-30T20:00:00.000Z','2026-10-01T01:00:00.000Z'),
      row('2026-10-01T02:00:00.000Z','2026-10-01T07:00:00.000Z'),
      row('2026-11-11T02:00:00.000Z','2026-11-11T07:00:00.000Z')];
    const {report,model}=fitProbabilityModel(records,'2026-10-01T00:00:00.000Z',now,'b'.repeat(64));
    expect(report).toMatchObject({calibration:1,holdout:1,rejected:2,purged:1});
    expect(model.groups[0].calibration.n).toBe(1);
  });
  it('rejects duplicate observations and old or incomplete archive profiles', () => {
    const r=row('2026-09-30T01:00:00.000Z','2026-09-30T06:00:00.000Z');
    expect(()=>fitProbabilityModel([r,r],'2026-10-01T00:00:00.000Z',now,'b'.repeat(64))).toThrow(/Duplicate/);
    expect(()=>fitProbabilityModel([{...r,inputProfile:'trend-market-only'}],'2026-10-01T00:00:00.000Z',now,'b'.repeat(64))).toThrow();
  });
  it('fits a synthetic chronological dataset and serves only its independently checked group', () => {
    const key = probabilityKey(reading());
    const records: ProbabilityObservation[] = [];
    const add = (start: string, count: number, stepHours: number, calibration: boolean) => {
      for (let i = 0; i < count; i++) {
        const at = Date.parse(start) + i * stepHours * 3_600_000;
        const member = !calibration || i % 2 === 0;
        const sequence = calibration ? Math.floor(i / 2) : i;
        records.push({ ...row(new Date(at).toISOString(), new Date(at + 5 * 3_600_000).toISOString()),
          key: member ? key : `${key}:baseline`, success: sequence % 10 < (member ? 7 : 3) });
      }
    };
    add('2026-07-20T00:00:00.000Z', 200, 6, true);
    add('2026-09-15T00:00:00.000Z', 100, 12, false);
    const { model, report } = fitProbabilityModel(records, '2026-09-15T00:00:00.000Z', now, 'c'.repeat(64));
    expect(report).toMatchObject({ calibration: 200, holdout: 100, rejected: 0, purged: 0 });
    expect(estimateProbability(reading(), model, now, health)).toMatchObject({
      status: 'validated', value: 71 / 102, calibrationSamples: 100, validationSamples: 100,
    });
  });
});
