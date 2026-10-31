import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="block text-center text-2xl font-bold text-white tracking-tight mb-2">MacroFlow</Link>
        <p className="text-center text-xs text-zinc-400 mb-8">Trading journal · Free beta</p>
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          <p className="mt-2 mb-6 text-sm leading-relaxed text-zinc-400">{description}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
