// This is a UI consistency guard; server-verified identity remains authoritative.
let expectedUser: string | null = null;
export const SESSION_EVENT = 'macroflow-journal-session';

export function setJournalUser(userId: string | null) { expectedUser = userId; }
export function getJournalUser() { return expectedUser; }

export function announceSessionChange(userId: string | null = null) {
  try {
    localStorage.setItem(SESSION_EVENT, JSON.stringify({ userId, nonce: crypto.randomUUID() }));
  } catch {
    // Storage may be disabled. Focus checks and request identity binding still apply.
  }
}
