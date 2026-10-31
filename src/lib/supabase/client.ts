'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicSupabaseConfig } from './config';

export function createBrowserAuthClient() {
  const { url, key } = publicSupabaseConfig();
  return createBrowserClient(url, key);
}
