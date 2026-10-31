import { NextResponse, type NextRequest } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const access = await requireJournalAccess(request);
  if (!access.ok) return access.response;
  return NextResponse.json({ userId: access.userId }, { headers: { 'Cache-Control': 'private, no-store' } });
}
