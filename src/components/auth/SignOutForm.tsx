'use client';

import { signOut } from '@/app/auth/actions';
import { announceSessionChange } from '@/lib/journal-session';

export default function SignOutForm() {
  return <form action={signOut} onSubmit={() => announceSessionChange()}>
    <button className="text-zinc-400 hover:text-white underline">Sign out</button>
  </form>;
}
