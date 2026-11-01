import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, BookOpen, SquaresFour } from '@phosphor-icons/react/ssr';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="MacroFlow home">
      MacroFlow
    </Link>
  );
}

export default function WorkspaceHeader({
  active,
  children,
  status,
  meta,
}: {
  active: 'overview' | 'journal';
  children?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <div className="workspace-header-inner">
        <div className="workspace-identity">
          <div className="workspace-title-row">
            {active === 'overview' ? (
              <h1 aria-label="MacroFlow">
                <Brand />
              </h1>
            ) : (
              <Brand />
            )}
            {status}
          </div>
          <p className="workspace-subtitle">
            {active === 'overview'
              ? 'Fundamental Trading Bias Dashboard'
              : 'Trading Journal'}
          </p>
        </div>
        <nav className="workspace-nav" aria-label="Main navigation">
          <Link
            href="/"
            aria-current={active === 'overview' ? 'page' : undefined}
          >
            <SquaresFour size={17} aria-hidden="true" />
            Overview
          </Link>
          <Link
            href="/journal"
            aria-current={active === 'journal' ? 'page' : undefined}
          >
            <BookOpen size={17} aria-hidden="true" />
            Journal
          </Link>
        </nav>
        {meta && <div className="workspace-header-meta">{meta}</div>}
        <div className="workspace-header-actions">
          {children ?? (
            <Link href="/signup" className="header-signup">
              Get started <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
