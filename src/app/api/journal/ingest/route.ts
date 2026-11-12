import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Redis } from '@upstash/redis';
import { ZodError } from 'zod';
import { supabase } from '@/lib/supabase';
import { checkJournalAccess, accessUnavailable } from '@/lib/journal-access';
import { identityError } from '@/lib/auth-session';
import {
  INGEST_MAX_BODY_BYTES,
  hashApiKey,
  validateIngestBody,
} from '@/lib/ingest';
import {
  authenticateApiKey,
  checkIngestRateLimit,
} from '@/lib/ingest-store';
import { accountFailure } from '@/lib/account-api';

export const dynamic = 'force-dynamic';

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function unauthorized() {
  return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
}

/**
 * POST /api/journal/ingest — EA auto-sync endpoint.
 * Bearer-key auth (NOT the login cookie; the proxy carves this path out).
 * Idempotent upserts keyed on (user_id, broker_account_id, broker_trade_id).
 */
export async function POST(request: NextRequest) {
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  if (!match) return unauthorized();

  const keyHash = hashApiKey(match[1]);
  let authed: Awaited<ReturnType<typeof authenticateApiKey>>;
  try {
    authed = await authenticateApiKey(supabase, keyHash);
  } catch {
    return NextResponse.json({ error: 'API key storage unavailable. Please retry.', code: 'ACCESS_CHECK_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
    });
  }
  if (!authed) return unauthorized();

  // A valid key does not outlive its owner's journal permission.
  try {
    const { data, error } = await supabase.auth.admin.getUserById(authed.userId);
    const access = error ? identityError(error) : await checkJournalAccess(supabase, data.user);
    if (!access.ok) {
      return NextResponse.json({ error: access.error, code: access.code }, {
        status: access.status === 401 ? 403 : access.status,
        headers: { 'Cache-Control': 'private, no-store', ...(access.status === 503 ? { 'Retry-After': '30' } : {}) },
      });
    }
  } catch {
    const access = accessUnavailable();
    return NextResponse.json({ error: access.error, code: access.code }, { status: 503 });
  }

  if (!(await checkIngestRateLimit(redisClient(), keyHash))) {
    return NextResponse.json({ error: 'Rate limit exceeded (30 req/min)' }, { status: 429 });
  }

  const text = await request.text();
  if (text.length > INGEST_MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload exceeds 256 KB limit' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let validated: ReturnType<typeof validateIngestBody>;
  try {
    validated = validateIngestBody(body);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first ? first.path.join('.') : 'body';
      const message = first ? first.message : 'Validation failed';
      return NextResponse.json({ error: `Invalid field ${field}: ${message}` }, { status: 400 });
    }
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  const { payload, rows, errors } = validated;

  try {
    const { data, error } = await supabase.rpc('ingest_managed_journal', {
      p_user_id: authed.userId,
      p_account: {
        account_login: payload.account_login,
        server: payload.server,
        currency: payload.currency ?? null,
        ea_version: payload.ea_version,
      },
      p_trades: rows,
    });
    if (error) return accountFailure(error);

    return NextResponse.json({
      ok: true,
      received: rows.length,
      ...data,
      errors,
    });
  } catch {
    // Deliberately generic: never leak key material or payload contents.
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
  }
}
