import type { NextRequest } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { accountIdSchema, accountPatchSchema, accountRemovalSchema } from '@/lib/account-management';
import { accountFailure, accountResponse, checkAccountOrigin } from '@/lib/account-api';

type Context = { params: Promise<{ id: string }> };

async function mutate(request: NextRequest, context: Context, remove: boolean) {
  const originError = checkAccountOrigin(request);
  if (originError) return originError;
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  const id = accountIdSchema.safeParse((await context.params).id);
  if (!id.success) return accountResponse({ error: 'Invalid account ID.' }, 400);
  const body: unknown = await request.json().catch(() => null);
  const parsed = remove ? accountRemovalSchema.safeParse(body) : accountPatchSchema.safeParse(body);
  if (!parsed.success) return accountResponse({ error: parsed.error.issues[0].message }, 400);
  const data = parsed.data;
  const { error, data: result } = await supabase.rpc('manage_broker_account_v2', {
    p_user_id: auth.userId, p_account_id: id.data,
    p_expected_version: data.expectedVersion, p_operation_id: data.operationId,
    p_action: 'action' in data ? data.action : 'remove',
    ...('displayName' in data ? { p_display_name: data.displayName, p_notes: data.notes } : {}),
    ...('deleteTrades' in data ? { p_delete_trades: data.deleteTrades, p_confirmation: data.confirmation } : {}),
  });
  if (error) return accountFailure(error);
  return accountResponse(result);
}

export const PATCH = (request: NextRequest, context: Context) => mutate(request, context, false);
export const DELETE = (request: NextRequest, context: Context) => mutate(request, context, true);
