import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/journal/:path*', '/api/journal/:path*', '/journal-access', '/upgrade',
    '/login', '/signup', '/check-email', '/forgot-password', '/reset-password', '/auth/:path*',
  ],
};
