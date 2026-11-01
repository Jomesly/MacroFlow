'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    theme: 'dark';
    size: 'flexible';
    'response-field': false;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export default function Turnstile({ siteKey, onToken }: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    if (widget.current !== null) window.turnstile?.remove(widget.current);
    widget.current = null;
  }, []);

  function fail() {
    onToken('');
    setFailed(true);
  }

  return (
    <div>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => {
          if (!container.current || widget.current !== null) return;
          if (!window.turnstile) return fail();
          widget.current = window.turnstile.render(container.current, {
            sitekey: siteKey, theme: 'dark', size: 'flexible', 'response-field': false,
            callback: (token) => { setFailed(false); onToken(token); },
            'expired-callback': () => onToken(''),
            'error-callback': fail,
          });
        }}
        onError={fail}
      />
      <div ref={container} aria-label="Security check" />
      {failed && <p role="alert" className="mt-2 text-sm text-red-400">The security check could not load. Refresh the page and try again.</p>}
    </div>
  );
}
