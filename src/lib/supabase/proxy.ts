import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicSupabaseConfig } from './config';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  if (request.nextUrl.pathname === '/api/journal/ingest') return response;
  try {
    const { url, key } = publicSupabaseConfig();
    const auth = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          const next = NextResponse.next({ request });
          response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
          response.headers.forEach((value, name) => {
            if (['cache-control', 'pragma', 'expires'].includes(name)) next.headers.set(name, value);
          });
          cookiesToSet.forEach(({ name, value, options }) => next.cookies.set(name, value, options));
          Object.entries(headers).forEach(([name, value]) => next.headers.set(name, value));
          response = next;
        },
      },
    });
    // Signature verification/refresh here; current identity and access at entry points.
    await auth.auth.getClaims();
  } catch {
    // Entry points return 401 or retryable 503. Never authorize using cookie presence.
  }
  return response;
}
