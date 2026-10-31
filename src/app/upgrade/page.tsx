import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';

export default function UpgradePage() {
  return (
    <AuthShell title="Your journal is free during beta" description="Verified users with active beta access can log trades, review History and Analytics, and connect MT5 without a card or subscription.">
      <Link href="/journal" className="text-sm text-blue-400 underline">Open your journal</Link>
      <p className="mt-4 text-xs text-zinc-500">MT5 sync is still in beta. Any future paid features will be announced separately.</p>
    </AuthShell>
  );
}
