import { describe, it, expect } from 'vitest';
import { normalizeImportRows, readImportCsv, suggestImportMapping, importReportCsv } from '../journal-import-parser';
import { importPreviewSchema, type ImportOptions } from '../journal-import-types';
import { computeAnalytics } from '../analytics';
import { computeWeeklyReview } from '../weekly-review';
import type { Trade } from '../types';

const options = (csv: string, patch: Partial<ImportOptions> = {}): ImportOptions => ({ mapping: suggestImportMapping(readImportCsv(csv, patch.delimiter).headers), delimiter: ',', dateFormat: 'ISO', dateMeaning: 'close', timezone: 'Asia/Manila', decimal: '.', moneyMode: 'signed', netConfirmed: true, defaultStatus: 'closed', aliases: {}, ...patch });
const normalize = (csv: string, patch: Partial<ImportOptions> = {}, currency = 'USD') => normalizeImportRows(csv, options(csv, patch), currency);
describe('CSV import normalization', () => {
  it('reads BOM, quoted delimiters, escaped quotes and multiline notes without fabricating prices', () => {
    const csv = '\uFEFFDate,Symbol,Direction,Net P&L,Tags,Notes\r\n2025-01-10,Gold,Buy,125.50,"Pullback,Pullback","Waited, then said ""go""\nPatient entry"';
    const [row] = normalize(csv);
    expect(row.errors).toEqual([]);
    expect(row.trade).toMatchObject({ entryPrice: null, exitPrice: null, netPnl: '125.5', result: 'win', symbol: 'XAUUSD', direction: 'long', datePrecision: 'date', closedPrecision: 'date', setupTags: ['Pullback'] });
    expect(row.trade?.timestamp).toBe('2025-01-09T16:00:00.000Z');
    expect(row.trade?.notes).toContain('"go"\nPatient');
  });
  it('validates size, unique headers, column counts and 1000 row boundary', () => {
    expect(() => readImportCsv('Date,Date\n1,2')).toThrow(/unique/);
    expect(() => readImportCsv('Date,Symbol\n1')).toThrow(/column/);
    expect(() => readImportCsv('A\n' + 'x\n'.repeat(1001))).toThrow(/1,000/);
    expect(readImportCsv('A\n' + 'x\n'.repeat(1000)).rows).toHaveLength(1000);
    expect(() => readImportCsv('A\n' + 'é'.repeat(1024 * 1024))).toThrow(/2 MB/);
  });
  it('requires explicit DMY/MDY and rejects invalid/future dates', () => {
    const csv = 'Date,Symbol,Direction,Result\n03/04/2025,GBPUSD,Sell,Loss';
    expect(normalize(csv)[0].status).toBe('invalid');
    expect(normalize(csv, { dateFormat: 'DMY' })[0].trade?.timestamp).toContain('2025-04-02T16:00');
    expect(normalize(csv, { dateFormat: 'MDY' })[0].trade?.timestamp).toContain('2025-03-03T16:00');
    expect(normalize(csv.replace('03/04/2025', '31/02/2025'), { dateFormat: 'DMY' })[0].status).toBe('invalid');
    expect(normalize(csv.replace('03/04/2025', '2099-01-01'))[0].status).toBe('invalid');
  });
  it('rejects ambiguous and nonexistent DST times, accepts explicit offsets', () => {
    const csv = 'Date,Symbol,Direction,Result\n2025-11-02T01:30:00,GBPUSD,Sell,Loss';
    expect(normalize(csv, { timezone: 'America/New_York' })[0].errors[0]).toMatch(/occurs twice/);
    expect(normalize(csv.replace('2025-11-02T01:30:00', '2025-03-09T02:30:00'), { timezone: 'America/New_York' })[0].errors[0]).toMatch(/does not exist/);
    expect(normalize(csv.replace('01:30:00', '01:30:00-04:00'), { timezone: 'America/New_York' })[0].status).toBe('ready');
  });
  it('applies result signs, validates currency precision and rejects conflicting outcomes', () => {
    const csv = 'Date,Symbol,Direction,Result,Net P&L\n2025-01-10,XAUUSD,Buy,Loss,100';
    expect(normalize(csv)[0].errors[0]).toMatch(/conflicts/);
    expect(normalize(csv, { moneyMode: 'result-amount' })[0].trade?.netPnl).toBe('-100');
    expect(normalize(csv.replace(',100', ',0'), { moneyMode: 'result-amount' })[0].status).toBe('invalid');
    expect(normalize(csv.replace('Loss,100', 'Win,0.00000001'), {}, 'BTC')[0].trade?.netPnl).toBe('0.00000001');
    expect(normalize(csv.replace('Loss,100', 'Win,0.001'))[0].status).toBe('invalid');
    expect(normalize(csv.replace('Loss,100', 'Breakeven,0'))[0].trade?.netPnl).toBe('0');
    expect(normalize('Date;Symbol;Direction;Net P&L\n2025-01-10;XAUUSD;Buy;1.234,56', { delimiter: ';', decimal: ',' })[0].trade?.netPnl).toBe('1234.56');
  });
  it('preserves unknown cash/dates and validates open trades', () => {
    const csv = 'Date,Symbol,Direction,Result\n2025-01-10,XAUUSD,Buy,Win';
    expect(normalize(csv, { dateMeaning: 'entry' })[0]).toMatchObject({ status: 'ready', trade: { closedAt: null, netPnl: null } });
    expect(normalize(csv, { dateMeaning: 'entry' })[0].warnings).toHaveLength(2);
    const open = 'Date,Symbol,Direction\n2025-01-10,XAUUSD,Buy';
    expect(normalize(open, { dateMeaning: 'entry', defaultStatus: 'open' })[0].status).toBe('ready');
    expect(normalize(open, { defaultStatus: 'open' })[0].status).toBe('invalid');
  });
  it('supports aliases and corrections while reporting unsupported symbols and currencies', () => {
    const csv = 'Date,Symbol,Direction,Result,Currency\n2025-01-10,MyGold,Buy,Win,USD';
    expect(normalize(csv)[0].status).toBe('invalid');
    const opts = options(csv, { aliases: { MyGold: 'XAUUSD' } });
    expect(normalizeImportRows(csv, opts, 'USD', { '2': { Currency: 'EUR' } })[0].errors[0]).toMatch(/Currency EUR/);
    expect(normalizeImportRows(csv, opts, 'USD')[0].status).toBe('ready');
    const report = importReportCsv([{ row: 2, cells: { Notes: '=HYPERLINK("bad")' }, errors: [], warnings: [], trade: null, status: 'invalid' }]);
    expect(report).toContain("\"'=HYPERLINK");
    expect(importPreviewSchema.safeParse({ filename: 'journal.csv', content: csv, target: { newAccount: { brokerName: 'Firm', accountNumber: '001', currency: 'USD' } }, options: opts }).success).toBe(true);
  });
  it('reads Notion month names and rejects inherited object names as directions or outcomes', () => {
    const csv = 'Date,Symbol,Direction,Result\n"January 10, 2025",XAUUSD,Buy,Win';
    expect(normalize(csv, { dateFormat: 'Notion' })[0].trade?.timestamp).toBe('2025-01-09T16:00:00.000Z');
    expect(normalize(csv.replace(',Buy,Win', ',constructor,Win'), { dateFormat: 'Notion' })[0].errors[0]).toMatch(/Direction/);
    expect(normalize(csv.replace(',Buy,Win', ',Buy,constructor'), { dateFormat: 'Notion' })[0].errors[0]).toMatch(/result/);
  });
  it('keeps date-only closing records in their source calendar and week without inventing an entry session', () => {
    const csv = 'Date,Symbol,Direction,Net P&L\n2025-01-13,XAUUSD,Buy,100';
    const imported = normalize(csv)[0].trade!;
    const trade: Trade = { id: 'test', ...imported, symbol: 'XAUUSD', importInfo: imported, brokerAccountId: null, pnlPercent: null, pnlAmount: 100, rMultiple: null };
    const analytics = computeAnalytics([trade]);
    expect(analytics.calendar[0].date).toBe('2025-01-13');
    expect(analytics.bySession['Unknown entry time'].trades).toBe(1);
    expect(computeAnalytics([trade], { from: '2025-01-13' }).totals.trades).toBe(1);
    expect(computeWeeklyReview([trade], '2025-01-13').trades).toHaveLength(1);
    expect(computeWeeklyReview([trade], '2025-01-06').trades).toHaveLength(0);
  });
});
