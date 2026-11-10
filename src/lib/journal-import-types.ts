import { z } from 'zod';
import { tradingAccountSchema } from './trading-account-types';

export const IMPORT_LIMIT = 1000;
export const IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_FIELDS = ['date', 'closedDate', 'symbol', 'direction', 'entry', 'exit', 'result', 'pnl', 'currency', 'tags', 'notes', 'sourceId', 'status'] as const;
export const IMPORT_LABELS: Record<typeof IMPORT_FIELDS[number], string> = {
  date: 'Trade date', closedDate: 'Closing date (optional)', symbol: 'Symbol', direction: 'Direction', entry: 'Entry price (optional)', exit: 'Exit price (optional)', result: 'Result', pnl: 'Cash P&L / amount', currency: 'Currency (optional)', tags: 'Setup tags', notes: 'Notes', sourceId: 'Original trade ID (optional)', status: 'Open / closed status (optional)',
};
export const importOptionsSchema = z.object({
  mapping: z.record(z.enum(IMPORT_FIELDS), z.string().max(200)).default({} as Record<typeof IMPORT_FIELDS[number], string>),
  delimiter: z.enum([',', ';', '\t']).default(','),
  dateFormat: z.enum(['ISO', 'DMY', 'MDY', 'Notion']).default('ISO'),
  dateMeaning: z.enum(['entry', 'close']).default('close'),
  timezone: z.string().min(1).max(100),
  decimal: z.enum(['.', ',']).default('.'),
  moneyMode: z.enum(['signed', 'result-amount']).default('signed'),
  netConfirmed: z.literal(true, { error: 'Confirm that cash amounts are net of fees.' }),
  defaultStatus: z.enum(['open', 'closed']).default('closed'),
  aliases: z.record(z.string().max(100), z.string().max(20)).default({}),
}).strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export const importTargetSchema = z.union([
  z.object({ accountId: z.uuid() }).strict(),
  z.object({ newAccount: tradingAccountSchema }).strict(),
]);
export const importOpeningSchema = z.object({ mode: z.enum(['starting', 'current']), amount: z.string().max(25), effectiveAt: z.iso.datetime({ offset: true }) }).strict();
export const importPreviewSchema = z.object({
  filename: z.string().min(1).max(200), content: z.string().max(IMPORT_BYTES), target: importTargetSchema,
  options: importOptionsSchema, opening: importOpeningSchema.nullable().default(null),
  edits: z.record(z.string().regex(/^\d{1,4}$/), z.record(z.string().max(200), z.string().max(10_000))).default({}),
}).strict();
export type ImportPreviewRequest = z.infer<typeof importPreviewSchema>;
export interface ImportedTrade {
  symbol: string; direction: 'long' | 'short'; timestamp: string; closedAt: string | null;
  entryPrice: number | null; exitPrice: number | null; result: 'win' | 'loss' | 'breakeven' | null; netPnl: string | null;
  setupTags: string[]; notes: string; sourceId: string | null;
  dateMeaning: 'entry' | 'close'; datePrecision: 'date' | 'time'; closedPrecision: 'date' | 'time' | null; sourceDate: string; sourceClosedDate: string | null; timezone: string;
}
export interface ImportRow {
  row: number; cells: Record<string, string>; trade: ImportedTrade | null; errors: string[]; warnings: string[];
  status: 'ready' | 'invalid' | 'possible' | 'duplicate';
}
export interface ImportPreview {
  id: string; filename: string; accountLabel: string; currency: string; rows: ImportRow[];
  balance: { amount: string | null; effectiveAt: string | null; current: string | null; version: number };
  expiresAt: string;
}
export interface ImportBatchSummary {
  id: string; filename: string; accountId: string; createdAt: string; count: number; status: string;
  untouched: number; edited: number; removed: number;
}
export const importCommitSchema = z.object({ id: z.uuid(), rows: z.array(z.number().int().min(2).max(1001)).min(1).max(IMPORT_LIMIT), keepDuplicates: z.array(z.number().int().min(2).max(1001)).max(IMPORT_LIMIT).default([]) }).strict();
