'use client';

import { useActionState } from 'react';
import { completeOnboarding } from '@/app/journal/welcome/actions';
import { AUTH_FIELD, AUTH_BUTTON } from './AuthForm';
import type { JournalProfile } from '@/lib/profile';

export default function WelcomeForm({ profile }: { profile: JournalProfile }) {
  const [state, submit, pending] = useActionState(completeOnboarding, {});
  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="expectedUser" value={profile.id} />
      <div>
        <label htmlFor="display-name" className="block text-sm text-zinc-300 mb-1.5">Display name (optional)</label>
        <input id="display-name" name="displayName" autoComplete="nickname" defaultValue={profile.display_name ?? ''} maxLength={80} className={AUTH_FIELD} />
      </div>
      <div>
        <label htmlFor="reporting-timezone" className="block text-sm text-zinc-300 mb-1.5">Preferred reporting timezone</label>
        <input id="reporting-timezone" name="reportingTimezone" defaultValue={profile.reporting_timezone} list="timezone-options" required maxLength={100} aria-describedby="timezone-help" className={AUTH_FIELD} />
        <datalist id="timezone-options"><option value="UTC" /><option value="Asia/Manila" /><option value="America/New_York" /><option value="Europe/London" /></datalist>
        <p id="timezone-help" className="mt-2 text-xs text-zinc-500">UTC is the default. Save your preference here; existing analytics still group dates in UTC and manual trade times display in your browser timezone.</p>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      <div className="grid gap-3">
        <button name="destination" value="log" disabled={pending} className={AUTH_BUTTON}>Log my first trade</button>
        <button name="destination" value="accounts" disabled={pending} className={AUTH_BUTTON + ' bg-zinc-800 hover:bg-zinc-700'}>Connect MT5 (beta)</button>
        <button name="destination" value="skip" disabled={pending} className="py-2 text-sm text-zinc-400 hover:text-white disabled:opacity-50">Save and explore journal</button>
      </div>
      {pending && <p role="status" className="text-sm text-zinc-400">Saving preferences…</p>}
    </form>
  );
}
