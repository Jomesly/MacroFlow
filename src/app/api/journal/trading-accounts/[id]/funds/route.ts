import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { fundsRequestSchema } from '@/lib/account-funds-types';
import { accountIdSchema, TradingAccountError } from '@/lib/trading-account-types';
import { journalRpc } from '@/lib/journal-rpc';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof TradingAccountError ? error.message : 'Account funds are unavailable. Please retry.' }, { status: error instanceof TradingAccountError ? error.status : 503, headers });
}
export async function GET(request: NextRequest, { params }: Context) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const offsetText = request.nextUrl.searchParams.get('offset') ?? '0';
  if (!accountIdSchema.safeParse(id).success || !/^\d{1,7}$/.test(offsetText) || Number(offsetText) > 1_000_000) return NextResponse.json({ error: 'Invalid account or history page.' }, { status: 400, headers });
  try { return NextResponse.json(await journalRpc('read_journal_funds', { p_user: auth.userId, p_account: id, p_offset: Number(offsetText) }), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!accountIdSchema.safeParse(id).success) return NextResponse.json({ error: 'Invalid trading account.' }, { status: 400, headers });
  try {
    const text = await request.text();
    if (text.length > 8192) return NextResponse.json({ error: 'Funds details are too long.' }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers }); }
    const parsed = fundsRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check funds details.' }, { status: 400, headers });
    const result = await journalRpc('mutate_journal_funds', { p_user: auth.userId, p_account: id, p_request: parsed.data.requestId, p_payload: parsed.data.mutation });
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) { return failure(error); }
}
