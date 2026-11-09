'use client';

import { useCallback, useEffect, useState } from 'react';
import { journalFetch } from '@/lib/journal-fetch';

type Screenshot = { slot: string; url: string; createdAt: string };
export default function TradeScreenshots({ tradeId }: { tradeId: string }) {
  const [images, setImages] = useState<Screenshot[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const endpoint = `/api/journal/trade/${tradeId}/screenshots`;
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await journalFetch(endpoint, { signal });
        if (!res.ok)
          throw new Error('Screenshots are temporarily unavailable.');
        const data = await res.json();
        if (!signal.aborted) {
          setImages(data.screenshots);
          setError('');
        }
      } catch (e) {
        if (!signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Could not load screenshots.',
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [endpoint],
  );
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial external fetch; state updates occur after the request resolves
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function upload(file: File) {
    if (file.size > 3 * 1024 * 1024) {
      setError('Choose an image up to 3 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('image', file);
      const res = await journalFetch(endpoint, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      setImages(data.screenshots);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(slot: string) {
    setBusy(true);
    setError('');
    try {
      const res = await journalFetch(`${endpoint}?slot=${slot}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Screenshot could not be removed.');
      setImages((rows) => rows.filter((r) => r.slot !== slot));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Removal failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Trade screenshots">
      <h4 className="text-sm font-semibold">Screenshots</h4>
      <p className="text-xs text-zinc-400">
        Up to three private PNG, JPEG or WebP images, 3 MB each.
      </p>
      {loading && <p role="status">Loading screenshots…</p>}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <div className="trade-screenshots">
        {images.map((image, index) => (
          <figure key={image.slot}>
            <a
              href={`${image.url}&v=${version}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private authenticated image; never send to the public optimizer */}
              <img
                src={`${image.url}&v=${version}`}
                alt={`Trade screenshot ${index + 1}`}
                loading="lazy"
                onError={() =>
                  setError(
                    'An image could not be loaded. Refresh screenshots to retry.',
                  )
                }
              />
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(image.slot)}
              className="text-xs underline mt-2"
            >
              Remove screenshot {index + 1}
            </button>
          </figure>
        ))}
      </div>
      <label className="block text-sm">
        Add screenshot
        <input
          className="block mt-2 max-w-full text-xs"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={loading || busy || images.length >= 3}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        className="text-xs underline"
        onClick={() => {
          setVersion((v) => v + 1);
          void load(new AbortController().signal);
        }}
      >
        Refresh screenshots
      </button>
      {busy && <p role="status">Saving screenshot changes…</p>}
    </section>
  );
}
