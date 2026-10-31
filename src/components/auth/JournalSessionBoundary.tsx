'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { announceSessionChange, SESSION_EVENT, setJournalUser } from '@/lib/journal-session';
import { journalErrorDestination } from '@/lib/journal-fetch';

/** Never let a retained tab submit another account's draft after cookies change. */
export default function JournalSessionBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let sequence = 0;
    setJournalUser(userId);
    function leave(destination = '/login') {
      stopped = true;
      setReady(false);
      window.location.replace(destination);
    }
    async function check() {
      const current = ++sequence;
      setChecking(true);
      try {
        const response = await fetch('/api/journal/session', { cache: 'no-store' });
        const body = await response.json();
        if (stopped || current !== sequence) return;
        const destination = journalErrorDestination(response.status, body.code);
        if (destination) return leave(destination);
        if (!response.ok) throw new Error('Session unavailable');
        if (body.userId !== userId) return leave();
        setError(false);
        setReady(true);
        setChecking(false);
      } catch {
        if (!stopped && current === sequence) setError(true);
      }
    }
    function changed(event: StorageEvent) {
      if (event.key !== SESSION_EVENT || !event.newValue) return;
      try {
        if (JSON.parse(event.newValue).userId !== userId) leave();
      } catch { /* Ignore malformed unrelated storage. */ }
    }
    function resumed() {
      if (document.visibilityState === 'visible') void check();
      else setChecking(true);
    }
    window.addEventListener('storage', changed);
    window.addEventListener('focus', resumed);
    window.addEventListener('pageshow', resumed);
    document.addEventListener('visibilitychange', resumed);
    announceSessionChange(userId);
    void check();
    return () => {
      stopped = true;
      setJournalUser(null);
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', resumed);
      window.removeEventListener('pageshow', resumed);
      document.removeEventListener('visibilitychange', resumed);
    };
  }, [userId, attempt]);
  return <>
    {checking && <div className="p-6 text-center text-sm text-zinc-400" role="status">
      {error ? <>Your session could not be checked. <button className="text-blue-400 underline" onClick={() => setAttempt(attempt + 1)}>Retry</button></> : 'Checking journal session…'}
    </div>}
    <div hidden={!ready || checking} inert={checking}>{ready ? children : null}</div>
  </>;
}
