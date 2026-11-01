export default function BetaNotice({ context }: { context: 'signup' | 'journal' }) {
  return (
    <aside className="beta-notice" aria-label="Beta testing notice">
      <strong>Beta testing</strong>
      <p>
        {context === 'signup'
          ? 'Account signup is in beta testing. Bugs may occur, and confirmation emails may be delayed or unavailable. Check your spam folder and try again later if no email arrives.'
          : 'The journal is in beta testing. You may encounter bugs with email confirmation, trade syncing, or analytics. Keep a separate copy of important trade records.'}
      </p>
    </aside>
  );
}
