'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export default function AccountDialog({ title, children, busy, onClose }: {
  title: string; children: ReactNode; busy: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6 text-zinc-200 shadow-2xl backdrop:bg-black/75">
    <div className="mb-5 flex items-start justify-between gap-4">
      <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
      <button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}
        className="rounded px-2 py-1 text-zinc-400 hover:text-white disabled:opacity-40">✕</button>
    </div>
    {children}
  </dialog>;
}
