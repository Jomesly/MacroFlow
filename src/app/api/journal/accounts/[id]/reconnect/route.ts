import type { NextRequest } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { accountIdSchema, accountReconnectSchema } from '@/lib/account-management';
import { accountFailure, accountResponse, checkAccountOrigin } from '@/lib/account-api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = checkAccountOrigin(request);
  if (originError) return originError;
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const id = accountIdSchema.safeParse((await context.params).id);
  if (!id.success) return accountResponse({ error: 'Invalid account ID.' }, 400);
  const parsed = accountReconnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return accountResponse({ error: parsed.error.issues[0].message }, 400);
  const { data, error } = await supabase.rpc('manage_broker_account_v2', {
    p_user_id: auth.userId, p_account_id: id.data, p_action: 'reconnect',
    p_expected_version: parsed.data.expectedVersion, p_operation_id: parsed.data.operationId,
  });
  return error ? accountFailure(error) : accountResponse(data);
}
