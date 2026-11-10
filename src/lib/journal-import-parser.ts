import { parse } from 'csv-parse/browser/esm/sync';
import { DateTime, IANAZone } from 'luxon';
import { moneyUnits, normalizeMoney } from './account-money';
import { TRADE_SYMBOLS } from './types';
import { IMPORT_BYTES, IMPORT_LIMIT, type ImportedTrade, type ImportOptions, type ImportRow } from './journal-import-types';

export function readImportCsv(content: string, delimiter = ',') {
  if (new TextEncoder().encode(content).length > IMPORT_BYTES) throw new Error('Choose a CSV smaller than 2 MB.');
  let records: string[][];
  try { records = parse(content, { bom: true, delimiter, skip_empty_lines: true, max_record_size: IMPORT_BYTES }) as string[][]; }
  catch { throw new Error('The CSV could not be read. Check its delimiter, quotation marks and column counts.'); }
  if (records.length < 2) throw new Error('The CSV needs a header and at least one trade.');
  if (records.length > IMPORT_LIMIT + 1) throw new Error('Import up to 1,000 trades at a time.');
  const headers = records[0].map(header => header.trim());
  if (headers.length > 100 || headers.some(header => !header || header.length > 200) || new Set(headers).size !== headers.length) throw new Error('Use up to 100 unique, nonempty column names.');
  return { headers, rows: records.slice(1).map((values, index) => ({ row: index + 2, cells: Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])) })) };
}

export function suggestImportMapping(headers: string[]) {
  const aliases: Record<string, string[]> = {
    date: ['date', 'trade date', 'closed at', 'entry date', 'closing date', 'date & time'], closedDate: ['closed date', 'exit date', 'exit time'], symbol: ['symbol', 'pair', 'instrument', 'market'], direction: ['direction', 'side', 'buy/sell', 'type'], entry: ['entry', 'entry price'], exit: ['exit', 'exit price'], result: ['result', 'outcome'], pnl: ['net pnl', 'net p&l', 'p&l', 'profit', 'profit/loss', 'amount', 'pnl'], currency: ['currency', 'account currency'], tags: ['tags', 'setup tags', 'strategy', 'setup'], notes: ['notes', 'journal notes', 'lesson', 'lessons'], sourceId: ['trade id', 'notion id', 'id'], status: ['status'],
  };
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headers.find(header => names.includes(header.toLowerCase().trim())) ?? ''])) as ImportOptions['mapping'];
}

function parseDate(value: string, options: ImportOptions) {
  const text = value.trim();
  if (!IANAZone.isValidZone(options.timezone) && options.timezone !== 'UTC') throw new Error('Choose a valid timezone such as Asia/Manila or America/New_York.');
  let date: DateTime;
  let precision: 'date' | 'time' = 'time';
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)) {
    precision = /^\d{4}-\d{2}-\d{2}$/.test(text) ? 'date' : 'time';
    date = DateTime.fromISO(text, { zone: options.timezone, setZone: true });
  } else {
    const bases = options.dateFormat === 'DMY' ? ['d/M/yyyy', 'd-M-yyyy'] : options.dateFormat === 'MDY' ? ['M/d/yyyy', 'M-d-yyyy'] : options.dateFormat === 'Notion' ? ['MMMM d, yyyy', 'MMM d, yyyy'] : [];
    const formats = bases.flatMap(base => [base, `${base} HH:mm`, `${base} HH:mm:ss`, `${base} h:mm a`, `${base}, h:mm a`]);
    date = DateTime.invalid('unmatched format');
    for (const format of formats) {
      const candidate = DateTime.fromFormat(text, format, { zone: options.timezone, locale: 'en', setZone: true });
      if (candidate.isValid) { date = candidate; precision = bases.includes(format) ? 'date' : 'time'; break; }
    }
  }
  if (!date.isValid) throw new Error('Date does not match the chosen format.');
  if (date.getPossibleOffsets().length > 1 && !/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new Error('This local time occurs twice because of daylight saving. Supply an ISO date with its UTC offset.');
  // Luxon advances nonexistent local times across DST; reject that adjustment.
  if (precision === 'time' && !/(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const sourceTime = text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?/i);
    if (sourceTime) {
      let hour = Number(sourceTime[1]);
      if (sourceTime[3]) hour = hour % 12 + (sourceTime[3].toUpperCase() === 'PM' ? 12 : 0);
      if (date.hour !== hour || date.minute !== Number(sourceTime[2])) throw new Error('This local time does not exist because of daylight saving.');
    }
  }
  if (date.toMillis() > Date.now() + 60_000) throw new Error('Trade dates cannot be in the future.');
  return { iso: date.toUTC().toISO()!, precision };
}

function decimal(value: string, separator: '.' | ','): string {
  let text = value.trim().replace(/[$€£₱]/g, '').trim();
  if (/^\(.*\)$/.test(text)) text = '-' + text.slice(1, -1);
  if (separator === ',') {
    if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(text)) throw new Error('Use comma decimals and dots for thousands, or change the number format.');
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) throw new Error('Use dot decimals and commas for thousands, or change the number format.');
    text = text.replace(/,/g, '');
  }
  return text.replace(/^\+/, '');
}

export function normalizeImportRows(content: string, options: ImportOptions, currency: string, edits: Record<string, Record<string, string>> = {}): ImportRow[] {
  const csv = readImportCsv(content, options.delimiter);
  for (const field of ['date', 'symbol', 'direction'] as const) if (!options.mapping[field]) throw new Error(`Match the ${field} column before previewing.`);
  for (const column of Object.values(options.mapping)) if (column && !csv.headers.includes(column)) throw new Error(`Column ${column} was not found in this CSV.`);
  const mapped = Object.values(options.mapping).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error('Match each source column to only one field.');
  return csv.rows.map(source => {
    const cells = { ...source.cells, ...edits[source.row] };
    const errors: string[] = [], warnings: string[] = [];
    const read = (field: keyof ImportOptions['mapping']) => (cells[options.mapping[field]] ?? '').trim();
    let trade: ImportedTrade | null = null;
    try {
      const rawSymbol = read('symbol');
      const symbol = (Object.hasOwn(options.aliases, rawSymbol) ? options.aliases[rawSymbol] : null) || ({ GOLD: 'XAUUSD', NAS100: 'US100', NASDAQ: 'US100', US30: 'DJ30', DOW: 'DJ30', 'BTC/USD': 'BTCUSD', 'XAU/USD': 'XAUUSD', 'GBP/USD': 'GBPUSD' } as Record<string, string>)[rawSymbol.toUpperCase()] || rawSymbol.toUpperCase();
      if (!(TRADE_SYMBOLS as readonly string[]).includes(symbol)) throw new Error(`Unsupported symbol “${rawSymbol}”. Correct it or add a symbol match.`);
      const rawDirection = read('direction').toLowerCase();
      const directions = { buy: 'long', long: 'long', sell: 'short', short: 'short' } as const;
      const direction = Object.hasOwn(directions, rawDirection) ? directions[rawDirection as keyof typeof directions] : null;
      if (!direction) throw new Error('Direction must be Buy/Long or Sell/Short.');
      const date = parseDate(read('date'), options);
      const closing = read('closedDate') ? parseDate(read('closedDate'), options) : options.dateMeaning === 'close' ? date : null;
      const rawResult = read('result').toLowerCase();
      const outcomes: Record<string, NonNullable<ImportedTrade['result']>> = { win: 'win', won: 'win', profit: 'win', loss: 'loss', lost: 'loss', breakeven: 'breakeven', 'break even': 'breakeven', be: 'breakeven' };
      let result: ImportedTrade['result'] = Object.hasOwn(outcomes, rawResult) ? outcomes[rawResult] : null;
      if (rawResult && !result) throw new Error('Unrecognized result. Use Win, Loss or Breakeven.');
      const rowCurrency = read('currency').toUpperCase();
      if (rowCurrency && rowCurrency !== currency) throw new Error(`Currency ${rowCurrency} differs from the target account’s ${currency}.`);
      let netPnl: string | null = null;
      if (read('pnl')) {
        const amount = normalizeMoney(decimal(read('pnl'), options.decimal), currency);
        if (options.moneyMode === 'result-amount') {
          if (!result) throw new Error('An unsigned amount needs a Win/Loss/Breakeven result.');
          if (moneyUnits(amount) < 0n) throw new Error('Use a positive amount with Result + amount, or choose Signed P&L.');
          if ((result === 'breakeven') !== (moneyUnits(amount) === 0n)) throw new Error('Breakeven needs zero; wins and losses need a nonzero amount.');
          netPnl = result === 'loss' ? normalizeMoney('-' + amount) : amount;
        } else netPnl = amount;
        const outcome = moneyUnits(netPnl) > 0n ? 'win' : moneyUnits(netPnl) < 0n ? 'loss' : 'breakeven';
        if (result && result !== outcome) throw new Error('Result conflicts with signed cash P&L. Correct the row or choose Result + amount.');
        result = outcome;
      }
      const status = read('status').toLowerCase() || options.defaultStatus;
      if (!['open', 'closed'].includes(status)) throw new Error('Status must be Open or Closed.');
      if (status === 'closed' && !result) throw new Error('A closed trade needs a result or cash P&L.');
      if (status === 'open' && (result || netPnl !== null || read('exit') || options.dateMeaning === 'close' || read('closedDate'))) throw new Error('Open trades cannot have a closing date, exit, result or cash P&L. Choose Entry date for open trades.');
      const price = (field: 'entry' | 'exit') => {
        if (!read(field)) return null;
        const number = Number(decimal(read(field), options.decimal));
        if (!Number.isFinite(number) || number <= 0 || number > 1e12) throw new Error(`${field === 'entry' ? 'Entry' : 'Exit'} price must be a positive number.`);
        return number;
      };
      if (closing && options.dateMeaning === 'entry' && closing.iso < date.iso) throw new Error('Closing date is earlier than entry date.');
      if (status === 'closed' && !closing) warnings.push('Closing date unknown; this cash result cannot affect the balance yet.');
      if (status === 'closed' && netPnl === null) warnings.push('Cash P&L unknown; balance coverage will be incomplete.');
      const notes = read('notes'), setupTags = [...new Map(read('tags').split(/[,;|]/).map(tag => tag.trim()).filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()];
      if (notes.length > 10_000 || setupTags.length > 30 || setupTags.some(tag => tag.length > 80) || read('sourceId').length > 256) throw new Error('Notes, tags or source ID exceed the supported length.');
      trade = { symbol, direction, timestamp: date.iso, closedAt: status === 'closed' ? closing?.iso ?? null : null, entryPrice: price('entry'), exitPrice: price('exit'), result, netPnl, setupTags, notes, sourceId: read('sourceId') || null, dateMeaning: options.dateMeaning, datePrecision: date.precision, closedPrecision: status === 'closed' ? closing?.precision ?? null : null, sourceDate: read('date'), sourceClosedDate: read('closedDate') || null, timezone: options.timezone };
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Check this row.'); }
    return { row: source.row, cells, trade, errors, warnings, status: errors.length ? 'invalid' : 'ready' };
  });
}

export function importSignature(trade: { symbol: string; direction: string; timestamp: string; entryPrice: number | null; exitPrice: number | null; result: string | null; netPnl: string | null }) {
  return JSON.stringify([trade.symbol, trade.direction, new Date(trade.timestamp).toISOString(), trade.entryPrice, trade.exitPrice, trade.result, trade.netPnl === null ? null : normalizeMoney(trade.netPnl)]);
}

export function importReportCsv(rows: ImportRow[]) {
  const cell = (value: string) => '"' + (/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"';
  const headers = [...new Set(rows.flatMap(row => Object.keys(row.cells)))];
  return [['Row', 'Status', 'Reason', ...headers], ...rows.map(row => [String(row.row), row.status, [...row.errors, ...row.warnings].join('; '), ...headers.map(header => row.cells[header] ?? '')])].map(row => row.map(cell).join(',')).join('\r\n');
}
