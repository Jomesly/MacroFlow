import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';

export default function AccountDeletedPage() {
  return <AuthShell title="Your account has been deleted" description="Your MacroFlow login, journal trades, profile, trading-account connections and API keys have been removed.">
    <p className="mb-6 text-sm text-zinc-400">Your accounts with brokers remain open.</p>
    <Link href="/" className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Return to MacroFlow</Link>
  </AuthShell>;
}
