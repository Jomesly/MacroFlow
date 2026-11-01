import type { ReactNode } from 'react';
import { ChartBar, CheckCircle, Notebook } from '@phosphor-icons/react/ssr';
import { Brand } from '@/components/WorkspaceHeader';

export default function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className="auth-page">
      <div>
        <Brand />
      </div>
      <div className="auth-content">
        <section className="auth-editorial" aria-label="About your journal">
          <div className="page-kicker">
            <span className="accent-line" />
            Built around your process
          </div>
          <h2>
            Trade with context.
            <br />
            Review with <span className="text-accent">clarity.</span>
          </h2>
          <p>
            Connect what the market was doing with what you did. A personal
            space for your trades, insights, and progress.
          </p>
          <div className="auth-editorial-features">
            <span>
              <Notebook size={16} aria-hidden="true" />
              Your trading record
            </span>
            <span>
              <ChartBar size={16} aria-hidden="true" />A clearer perspective
            </span>
          </div>
        </section>
        <section className="auth-form-panel">
          <span className="auth-beta">Trading journal · Free beta</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {children}
        </section>
      </div>
      <footer className="auth-footer">
        <span className="inline-flex items-center gap-2">
          <CheckCircle size={14} aria-hidden="true" />A more deliberate trading
          day.
        </span>
        <span>MacroFlow · Personal trading journal</span>
      </footer>
    </main>
  );
}
