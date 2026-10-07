import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MacroFlow — Trading Journal',
  description:
    'Log and review your trades — symbols, entries, exits, results, and setup tags in one place.',
};

export default function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
