'use client';

import { signOut } from '@/app/auth/actions';
import { announceSessionChange } from '@/lib/journal-session';
import { SignOut } from '@phosphor-icons/react';

export default function SignOutForm() {
  return (
    <form action={signOut} onSubmit={() => announceSessionChange()}>
      <button className="signout-button hover:text-white">
        <SignOut size={16} aria-hidden="true" />
        Sign out
      </button>
    </form>
  );
}
