'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type Ref } from 'react';
import { journalFetch } from '@/lib/journal-fetch';
import { clipboardImages, imageUploadError, prepareScreenshot, screenshotCapacity } from '@/lib/screenshot-browser';

type Screenshot = {
  id: string;
  slot: string | number;
  url: string;
  createdAt: string;
  clientUploadId?: string;
};
type Gallery = { screenshots: Screenshot[]; pendingUploadIds?: string[] };
type Draft = {
  id: string;
  file: File;
  prepared?: File;
  preview: string;
  status: 'queued' | 'preparing' | 'saving' | 'failed';
  error?: string;
  restart?: boolean;
};
export type TradeScreenshotsHandle = {
  paste: (event: ClipboardEvent) => void;
  canLeave: () => boolean;
  hasUnsaved: () => boolean;
};
type Props = { tradeId: string; editable?: boolean; ref?: Ref<TradeScreenshotsHandle> };
const CAPACITY_ERROR = 'This trade already has three screenshots. Remove one to add another.';

export default function TradeScreenshots({ tradeId, editable = false, ref }: Props) {
  const [images, setImages] = useState<Screenshot[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const imagesRef = useRef<Screenshot[]>([]);
  const draftsRef = useRef<Draft[]>([]);
  const pendingRef = useRef<string[]>([]);
  const loadingRef = useRef(true);
  const galleryReady = useRef(false);
  const removingRef = useRef<string | null>(null);
  const alive = useRef(false);
  const running = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const activeLoads = useRef(new Set<AbortController>());
  const picker = useRef<HTMLInputElement>(null);
  const pasteArea = useRef<HTMLDivElement>(null);
  const endpoint = `/api/journal/trade/${tradeId}/screenshots`;

  const updateDrafts = useCallback((rows: Draft[]) => {
    draftsRef.current = rows;
    setDrafts(rows);
  }, []);
  const applyGallery = useCallback((data: Gallery) => {
    galleryReady.current = true;
    imagesRef.current = data.screenshots;
    pendingRef.current = data.pendingUploadIds ?? [];
    setImages(data.screenshots);
    setPendingIds(pendingRef.current);
    const saved = new Set(data.screenshots.map((image) => image.clientUploadId));
    const remaining = draftsRef.current.filter((draft) => {
      if (!saved.has(draft.id)) return true;
      URL.revokeObjectURL(draft.preview);
      return false;
    });
    updateDrafts(remaining);
  }, [updateDrafts]);

  const refresh = useCallback(async (signal: AbortSignal, quiet = false) => {
    try {
      const response = await journalFetch(endpoint, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Screenshots are temporarily unavailable.');
      if (!alive.current || signal.aborted) return;
      applyGallery(data);
      setVersion((value) => value + 1);
      if (!quiet) setError('');
    } catch (reason) {
      if (alive.current && !signal.aborted && !quiet) {
        setError(reason instanceof Error ? reason.message : 'Screenshots could not be loaded.');
      }
    } finally {
      if (alive.current && !signal.aborted) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [applyGallery, endpoint]);

  const cancelLoads = useCallback(() => {
    for (const controller of activeLoads.current) controller.abort();
    activeLoads.current.clear();
  }, []);

  const hasUnsaved = useCallback(() => draftsRef.current.length > 0 || removingRef.current !== null, []);
  const canLeave = useCallback(() => {
    if (!hasUnsaved()) return true;
    const working = draftsRef.current.some((draft) => draft.status !== 'failed') || removingRef.current !== null;
    return window.confirm(working
      ? 'Screenshots are still saving. Leave this trade? Unfinished screenshots may not be saved. Choose Cancel to stay.'
      : 'Some screenshots could not be saved. Leave and discard their previews? Screenshots already saved will stay on the trade. Choose Cancel to stay.');
  }, [hasUnsaved]);

  useEffect(() => {
    alive.current = true;
    if (editable) pasteArea.current?.focus({ preventScroll: true });
    const controllers = requests.current;
    const controller = new AbortController();
    controllers.add(controller);
    activeLoads.current.add(controller);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load this mounted trade's external gallery
    void refresh(controller.signal).finally(() => { controllers.delete(controller); activeLoads.current.delete(controller); });
    const unload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!canLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    const currentUrl = window.location.href;
    const currentState = window.history.state;
    const navigation = (window as Window & { navigation?: EventTarget & { currentEntry?: { index: number } } }).navigation;
    const currentIndex = navigation?.currentEntry?.index;
    let restoringHistory = false;
    let allowedTraversal = false;
    const beforeTraverse = (event: Event) => {
      const change = event as Event & { navigationType?: string; destination?: { url: string } };
      if (change.navigationType !== 'traverse' || !event.cancelable || !hasUnsaved() || change.destination?.url === currentUrl) return;
      allowedTraversal = canLeave();
      if (!allowedTraversal) event.preventDefault();
    };
    const traverse = (event: PopStateEvent) => {
      if (allowedTraversal) { allowedTraversal = false; return; }
      if (restoringHistory) {
        restoringHistory = false;
        event.stopImmediatePropagation();
        return;
      }
      if (!hasUnsaved() || window.location.href === currentUrl || canLeave()) return;
      // popstate cannot be cancelled. Stop the router before it discards the
      // editor, then return to the original entry (preserving Back AND Forward).
      event.stopImmediatePropagation();
      const destinationIndex = navigation?.currentEntry?.index;
      if (currentIndex !== undefined && destinationIndex !== undefined && currentIndex !== destinationIndex) {
        restoringHistory = true;
        window.history.go(currentIndex - destinationIndex);
      } else {
        // Older browsers lack navigation entry indexes. Preserve the draft and
        // router state by restoring the current URL as a fresh history entry.
        window.history.pushState(currentState, '', currentUrl);
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    window.addEventListener('popstate', traverse, true);
    navigation?.addEventListener('navigate', beforeTraverse);
    return () => {
      alive.current = false;
      for (const request of controllers) request.abort();
      controllers.clear();
      for (const draft of draftsRef.current) URL.revokeObjectURL(draft.preview);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('popstate', traverse, true);
      navigation?.removeEventListener('navigate', beforeTraverse);
    };
  }, [canLeave, editable, hasUnsaved, refresh]);

  const runQueue = useCallback(async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      while (alive.current) {
        const draft = draftsRef.current.find((row) => row.status === 'queued');
        if (!draft) break;
        const controller = new AbortController();
        requests.current.add(controller);
        const patch = (values: Partial<Draft>) => {
          if (alive.current && !controller.signal.aborted) {
            updateDrafts(draftsRef.current.map((row) => row.id === draft.id ? { ...row, ...values } : row));
          }
        };
        try {
          patch({ status: 'preparing', error: undefined, restart: false });
          const prepared = draft.prepared ?? await prepareScreenshot(draft.file);
          if (!alive.current || controller.signal.aborted) break;
          patch({ prepared, status: 'saving' });
          setAnnouncement('Saving screenshot.');
          const body = new FormData();
          body.set('image', prepared);
          body.set('clientUploadId', draft.id);
          const response = await journalFetch(endpoint, { method: 'POST', body, signal: controller.signal });
          const data = await response.json();
          if (!response.ok) {
            const expired = data.newUploadRequired === true && ['SCREENSHOT_UPLOAD_EXPIRED', 'SCREENSHOT_UPLOAD_CANCELLED'].includes(data.code);
            patch({ restart: expired });
            throw new Error(data.code === 'SCREENSHOT_UPLOAD_PENDING'
              ? 'This screenshot is still being saved. Refresh or retry shortly.'
              : data.error ?? 'Screenshot could not be saved.');
          }
          if (!alive.current || controller.signal.aborted) break;
          cancelLoads();
          applyGallery(data);
          const remaining = draftsRef.current.filter((row) => row.id !== draft.id);
          if (remaining.length !== draftsRef.current.length) {
            URL.revokeObjectURL(draft.preview);
            updateDrafts(remaining);
          }
          setError('');
          setAnnouncement('Screenshot saved.');
        } catch (reason) {
          if (!alive.current || controller.signal.aborted) break;
          // A lost response can follow a committed upload. Reconcile before offering Retry.
          await refresh(controller.signal, true);
          if (draftsRef.current.some((row) => row.id === draft.id)) {
            patch({ status: 'failed', error: reason instanceof Error ? reason.message : 'Screenshot could not be saved.' });
            setAnnouncement('Screenshot could not be saved. Retry or remove its preview.');
          } else if (alive.current && !controller.signal.aborted) {
            setAnnouncement('Screenshot saved.');
          }
        } finally {
          requests.current.delete(controller);
        }
      }
    } finally {
      running.current = false;
    }
  }, [applyGallery, cancelLoads, endpoint, refresh, updateDrafts]);

  const addFiles = useCallback((files: File[]) => {
    if (!editable) return;
    if (loadingRef.current) { setError('Wait for screenshots to load, then paste again.'); return; }
    if (!galleryReady.current) { setError('Refresh screenshots before adding an image.'); return; }
    if (removingRef.current) { setError('Wait for screenshot removal to finish, then paste again.'); return; }
    cancelLoads();
    let capacity = screenshotCapacity(imagesRef.current.length, draftsRef.current.map((row) => row.id), pendingRef.current);
    const added: Draft[] = [];
    const failures: string[] = [];
    for (const file of files) {
      const invalid = imageUploadError(file);
      if (invalid) { failures.push(invalid); continue; }
      if (!capacity) { failures.push(CAPACITY_ERROR); continue; }
      added.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: 'queued' });
      capacity -= 1;
    }
    setError([...new Set(failures)].join(' '));
    if (added.length) {
      updateDrafts([...draftsRef.current, ...added]);
      setAnnouncement(`Preparing ${added.length === 1 ? 'screenshot' : `${added.length} screenshots`}.`);
      void runQueue();
    }
  }, [cancelLoads, editable, runQueue, updateDrafts]);

  useImperativeHandle(ref, () => ({
    paste: (event) => {
      if (!editable) return;
      const files = clipboardImages(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    },
    canLeave,
    hasUnsaved,
  }), [addFiles, canLeave, editable, hasUnsaved]);

  const retry = async (draft: Draft) => {
    if (draftsRef.current.find((row) => row.id === draft.id)?.status !== 'failed') return;
    if (removingRef.current) return;
    const controller = new AbortController();
    requests.current.add(controller);
    activeLoads.current.add(controller);
    await refresh(controller.signal, true);
    requests.current.delete(controller);
    activeLoads.current.delete(controller);
    if (!alive.current || controller.signal.aborted) return;
    const current = draftsRef.current.find((row) => row.id === draft.id);
    if (!current || current.status !== 'failed') return;
    if (current.restart && !window.confirm('The earlier upload expired or was cancelled. Start a new upload of this screenshot?')) return;
    const nextId = current.restart ? crypto.randomUUID() : current.id;
    updateDrafts(draftsRef.current.map((row) => row.id === current.id ? { ...row, id: nextId, status: 'queued', restart: false, error: undefined } : row));
    void runQueue();
  };

  const discard = (id: string) => {
    const draft = draftsRef.current.find((row) => row.id === id);
    if (!draft || draft.status !== 'failed') return;
    URL.revokeObjectURL(draft.preview);
    updateDrafts(draftsRef.current.filter((row) => row.id !== id));
    setAnnouncement('Unsaved preview removed. Refresh to check any upload still in progress.');
  };

  const remove = async (image: Screenshot) => {
    if (removingRef.current || running.current) return;
    cancelLoads();
    removingRef.current = image.id;
    setRemoving(image.id);
    setError('');
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await journalFetch(`${endpoint}?imageId=${encodeURIComponent(image.id)}`, { method: 'DELETE', signal: controller.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'Screenshot could not be removed.');
      }
      if (!alive.current || controller.signal.aborted) return;
      cancelLoads();
      applyGallery({ screenshots: imagesRef.current.filter((row) => row.id !== image.id), pendingUploadIds: pendingRef.current });
      setAnnouncement('Screenshot removed.');
    } catch (reason) {
      if (alive.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Screenshot could not be removed.');
    } finally {
      requests.current.delete(controller);
      if (alive.current && !controller.signal.aborted) { removingRef.current = null; setRemoving(null); }
    }
  };

  const capacity = screenshotCapacity(images.length, drafts.map((row) => row.id), pendingIds);
  const otherPending = pendingIds.filter((id) => !drafts.some((draft) => draft.id === id)).length;
  return (
    <section className="trade-screenshot-section space-y-3" aria-label="Trade screenshots">
      <div className="trade-screenshot-heading"><h4 className="text-sm font-semibold">Screenshots</h4><span className="text-xs text-zinc-400">{3 - capacity} of 3</span></div>
      {editable && <>
        <p className="text-xs text-zinc-400" id={`screenshot-help-${tradeId}`}>Screenshots save automatically. Save applies to the trade fields above.</p>
        <div ref={pasteArea} className="trade-screenshot-paste" role="group" tabIndex={0} aria-label="Paste a screenshot" aria-describedby={`screenshot-help-${tradeId}`}>
          <span>Paste a screenshot with <kbd>Ctrl+V</kbd> / <kbd>⌘V</kbd>, or choose an image</span>
          <button type="button" disabled={loading || capacity === 0 || removing !== null} onClick={() => picker.current?.click()} className="trade-screenshot-add">Add image</button>
          <input ref={picker} className="sr-only" type="file" aria-label="Choose screenshot images" accept="image/png,image/jpeg,image/webp" multiple disabled={loading || capacity === 0 || removing !== null} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; addFiles(files); }} />
          <small>Up to three private PNG, JPEG or WebP images. Large screenshots are compressed to fit 3 MiB.</small>
        </div>
      </>}
      {loading && <p className="text-xs text-zinc-400" role="status">Loading screenshots…</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <p role="status" className="sr-only" aria-live="polite">{announcement}</p>
      <div className="trade-screenshots">
        {images.map((image, index) => <figure key={image.id}>
          <a href={`${image.url}&v=${version}`} target="_blank" rel="noopener noreferrer" aria-label={`Open trade screenshot ${index + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private image must use the authenticated route */}
            <img src={`${image.url}&v=${version}`} alt={`Trade screenshot ${index + 1}`} loading="lazy" onError={() => setError('An image could not be loaded. Refresh screenshots to retry.')} />
          </a>
          <figcaption className="trade-screenshot-caption"><span>Saved</span>{editable && <button type="button" disabled={removing !== null || drafts.some((draft) => draft.status !== 'failed')} onClick={() => void remove(image)} aria-label={`Remove screenshot ${index + 1}`}>{removing === image.id ? 'Removing…' : 'Remove'}</button>}</figcaption>
        </figure>)}
        {drafts.map((draft, index) => <figure key={draft.id}>
          {/* eslint-disable-next-line @next/next/no-img-element -- in-memory local upload preview */}
          <img src={draft.preview} alt={`Unsaved screenshot ${index + 1}`} />
          <figcaption className="trade-screenshot-caption"><span>{draft.status === 'failed' ? 'Could not save' : draft.status === 'saving' ? 'Saving…' : 'Preparing…'}</span></figcaption>
          {draft.status === 'failed' && <><p className="text-xs text-red-400" role="alert">{draft.error}</p><div className="trade-screenshot-actions"><button type="button" disabled={removing !== null} onClick={() => void retry(draft)}>{draft.restart ? 'Start new upload' : 'Retry'}</button><button type="button" onClick={() => discard(draft.id)}>Remove preview</button></div></>}
        </figure>)}
      </div>
      {otherPending > 0 && <p className="text-xs text-zinc-400" role="status">{otherPending === 1 ? 'A screenshot is' : `${otherPending} screenshots are`} still being saved. Refresh to check progress.</p>}
      {!loading && images.length === 0 && drafts.length === 0 && otherPending === 0 && <p className="text-xs text-zinc-400">No screenshots attached.</p>}
      {editable && capacity === 0 && <p className="text-xs text-zinc-400">{CAPACITY_ERROR}</p>}
      <button type="button" className="text-xs underline" disabled={loading || removing !== null || drafts.some((draft) => draft.status !== 'failed')} onClick={() => { cancelLoads(); const controller = new AbortController(); requests.current.add(controller); activeLoads.current.add(controller); void refresh(controller.signal).finally(() => { requests.current.delete(controller); activeLoads.current.delete(controller); }); }}>Refresh screenshots</button>
    </section>
  );
}
