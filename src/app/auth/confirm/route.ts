import { NextResponse, type NextRequest } from 'next/server';
import { createServerAuthClient } from '@/lib/supabase/server';
import { applicationOrigin } from '@/lib/auth-validation';

export const dynamic = 'force-dynamic';

function retryResponse(status: 429 | 503 = 503) {
  return new NextResponse(status === 429
    ? 'Too many verification attempts. Please wait, then retry this link.'
    : 'Email verification is temporarily unavailable. Please retry the link shortly.', {
    status, headers: {
      'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'Retry-After': status === 429 ? '60' : '30',
    },
  });
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get('type');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const code = request.nextUrl.searchParams.get('code');
  const failure = type === 'recovery' ? '/forgot-password?error=invalid-link' : '/check-email?error=invalid-link';
  let destination = failure;
  try {
    if (tokenHash && !request.nextUrl.searchParams.has('code') && tokenHash.length <= 2048 && (type === 'email' || type === 'recovery')) {
      const auth = await createServerAuthClient();
      const { error } = await auth.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error?.status === 429) return retryResponse(429);
      if (error && (!error.status || error.status >= 500)) return retryResponse();
      if (!error) destination = type === 'recovery' ? '/reset-password' : '/journal/welcome';
    } else if (code && !request.nextUrl.searchParams.has('token_hash') && !type && code.length <= 2048) {
      // Standard Supabase templates verify the email first, then return a PKCE
      // code. Exchange it using the initiating browser's verifier cookie.
      const auth = await createServerAuthClient();
      const { data, error } = await auth.auth.exchangeCodeForSession(code);
      if (error?.status === 429) return retryResponse(429);
      if (error && (!error.status || error.status >= 500)) return retryResponse();
      if (error?.name === 'AuthPKCECodeVerifierMissingError' || error?.code === 'bad_code_verifier') {
        destination = '/check-email?error=browser-mismatch';
      } else if (!error) {
        // Recovery intent comes from SDK verifier storage, never request input.
        // The installed SDK returns this marker at runtime but omits it from its public response type.
        const recovery = 'redirectType' in data && data.redirectType === 'recovery';
        destination = recovery ? '/reset-password' : '/journal/welcome';
      }
    }
    const response = NextResponse.redirect(new URL(destination, applicationOrigin()), 303);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return retryResponse();
  }
}
