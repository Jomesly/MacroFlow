# Trade screenshots: paste from the clipboard

Status: implemented and locally verified, 2026-11-23. See
[local results](../tests/screenshots/LOCAL-RESULTS.md) and the
[operation and deployment guide](journal-screenshots.md). Hosted rollout remains
a separate step; the production feature flag has not been enabled.
Branch: `feature/journal-trade-images`, based on `b942ef3`.

## 1. Intended outcome

A desktop user captures or copies a chart, opens **Journal > History > trade > Edit**, and presses **Ctrl+V**. The screenshot appears immediately as a preview, uploads automatically, and becomes permanently attached to that specific trade after the server confirms the save. Reopening the trade or using another device shows the saved image.

The requested shortcut is interpreted as Ctrl+V for paste. Copying an existing image is usually Ctrl+C; an operating-system screenshot tool can also put an image on the clipboard. The app receives the image when the user pastes it.

Recommended product decisions for version one:

- Screenshot additions and removals save automatically. Notes, tags, and other trade fields keep their existing Save behavior.
- Show the explicit helper: **Screenshots save automatically. Save changes applies to the trade fields above.** Cancelling field edits does not undo a successfully saved screenshot.
- Limit each trade to three screenshots. Accept PNG, JPEG, and WebP, with a maximum stored size of 3 MiB (3,145,728 bytes) per image, matching the existing bucket.
- The read view shows a private thumbnail gallery. Edit shows that gallery plus paste, upload, retry, and remove controls.
- Keep a file-picker fallback for desktop and mobile. Support Command+V where the browser supplies a clipboard image.
- Apply the same attachment behavior to manual, CSV-imported, and MT5-synced trade records. Execution fields managed by sync keep their existing restrictions.
- Attach an image to the selected trade ID only. Shared-entry trades on other accounts do not automatically inherit it.

## 2. Existing implementation and gaps

Verified against the feature branch's base:

| Existing code | Current behavior | Planned change |
| --- | --- | --- |
| `src/components/TradeHistory.tsx` | Screenshots render only in the expanded read view | Read-only gallery there; editable screenshot area inside Edit/Close Trade |
| `src/components/TradeScreenshots.tsx` | File picker, immediate upload, remove, refresh | Add edit/view modes, clipboard intake, previews, queue, and explicit save states |
| `src/lib/screenshots.ts` | Three fixed Storage paths, signature/size checks, private reads | Add reservation/finalization, immutable image paths, retry identity, and durable cleanup |
| `src/app/api/journal/trade/[id]/screenshots/route.ts` | Authenticated GET/POST/DELETE; checks ownership before and after upload | Preserve its URL and privacy controls; integrate the durable attachment lifecycle |
| `supabase/journal-screenshots.sql` | Private server-only bucket, three supported MIME types, 3 MiB limit | Preserve these restrictions; add a forward migration for attachment metadata and cleanup |
| `src/lib/journal-features.ts` | Controlled by `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED` | Keep disabled until migration, deletion handling, and verification pass |

`docs/account-management-release-2026-11-12.md` explicitly identifies account/purge cleanup and concurrent uploads as prerequisites to enabling screenshots. That document reports the production flag was absent at release time; the actual current environment must be checked at cutover.

Deleting one trade currently removes its three image paths before deleting the database row. Bulk account purges and identity cascades do not use that route. The existing ownership recheck after upload does not provide recovery if the request crashes, or a cleanup attempt fails.

## 3. User flow and interface

1. Open History, expand a trade, and choose Edit (or the existing Close Trade action for an open trade).
2. Show a Screenshots section below Notes and tags, above the form action buttons.
3. Show **Paste a screenshot with Ctrl+V, or choose an image**, a keyboard-focusable paste area, an Add image button, and the count, for example `1 of 3`.
4. While focus is inside that trade's editor, pasting an image adds a local preview and starts saving it. Focus the paste area after choosing it; do not move focus away from a field on every render.
5. Each preview shows one of **Preparing**, **Saving**, **Saved**, or **Could not save — Retry / Remove**. Announce transitions through an accessible status region.
6. Only show Saved after the server confirms the attachment is ready. A local preview alone never means it is saved.
7. Reopening the trade fetches the server gallery. Clicking a thumbnail opens the authenticated full image using the existing private-image route.
8. Removing a screenshot immediately hides it after the server has durably accepted the deletion. Explain that this change saves automatically.

Paste handling rules:

- Use a React paste handler scoped to the active editor, not a page-wide keyboard listener.
- Read image files from `event.clipboardData.items` with `getAsFile()`. Use a files fallback if items are absent; do not process both lists and duplicate the same image.
- Only call `preventDefault()` after detecting image data that the editor will handle, including an image rejected with a visible validation message. Leave text-only paste unchanged in Notes and other inputs.
- For clipboard data containing text and an image, image intake takes precedence inside this editor; explain with the resulting preview/status. Text-only paste remains normal.
- If the clipboard contains a URL or HTML without an actual image file, do not download it. Show paste guidance when appropriate, and retain normal text behavior.
- No background clipboard reading, polling, or automatic reading on page load. A separate Paste button using `navigator.clipboard.read()` is unnecessary for version one.
- When three slots are occupied or reserved, show **This trade already has three screenshots. Remove one to add another.** Never replace an image silently.
- Multiple pasted files enter a sequential queue up to available capacity; report the rejected remainder. Reserve client capacity synchronously so rapid repeated paste cannot exceed the displayed limit.

## 4. Browser processing and upload behavior

Use one intake pipeline for paste and file selection:

`clipboard/file -> validate -> prepare preview -> upload queue -> authenticated API -> saved gallery`

- Bind every queue item to the original trade ID and a client-generated upload UUID. Do not obtain the destination from whatever trade happens to be open when a request finishes.
- Check file type, source size, and decoded dimensions. Proposed safety bounds are 20 MiB source data and 24 megapixels, with equivalent server checks for submitted data. Final persisted bytes must fit the existing 3 MiB limit.
- For a supported source already within the upload size limit, preserve its resolution. If it exceeds 3 MiB, try high-quality WebP compression in the browser. If necessary, reduce its longest edge to at most 4096 pixels, preserving aspect ratio. Never upscale.
- Stop at a readable quality floor, proposed WebP quality 0.85. If the image still exceeds 3 MiB, show **This screenshot is too large. Crop it or choose a smaller image.** Do not silently upload blurry text.
- These preparation bounds and quality settings are implementation defaults to verify against actual chart screenshots; they do not change the stored size limit.
- Send a multipart request with `image` and `clientUploadId` through `journalFetch`. Do not put image bytes or base64 strings into trade JSON, notes, localStorage, or the trades table.
- Preserve the in-memory File/Blob on recoverable failure so Retry does not require another paste. Reuse the same upload UUID for a retry of that operation.
- An intentional new paste is a new attachment operation. Identical image bytes are not automatically suppressed if pasted again intentionally.
- Revoke preview object URLs when replaced, removed, or unmounted. Abort stale fetches and ignore responses for an unmounted or different trade.
- During pending uploads, guard editor collapse, Cancel, and trade switching with a clear **Screenshots are still saving** choice to stay or leave. Leaving may abort the browser request; server cleanup still handles a request that already reached Storage. Use a navigation warning only while work is pending or failed and still recoverable locally.
- A failed image remains visibly unsaved. Users may retry or remove it. Saved images remain attached even if a separate trade-field save fails.
- On remount, reconcile with the server: a response lost after a successful upload must not produce a false duplicate or a false missing-image state.

## 5. Persistent data and API design

Keep actual image bytes in the private `journal-screenshots` Supabase Storage bucket. Add a server-managed attachment table, proposed name `journal_trade_screenshots`:

| Field | Purpose |
| --- | --- |
| `id` UUID | Stable attachment identity, also used in a unique object path |
| `user_id`, `trade_id` | Owner and original trade; retain for cleanup after parent deletion |
| `slot` integer, 0–2 | Display order and three-image capacity |
| `object_path` unique text | New format `<user-id>/<trade-id>/<image-id>`; never reuse an object path |
| `client_upload_id` UUID | Retry identity, unique within owner/trade |
| `content_hash` | Detect conflicting reuse of an upload operation ID with different content |
| `mime_type`, `byte_size`, `width`, `height` | Validated image information |
| `state` | `uploading`, `ready`, or `deleting` |
| `upload_expires_at`, timestamps | Bound incomplete uploads and enable recovery |

Enforce at most one active reservation per owner/trade/slot and at most three active reservations including uploading images. Allocate slots in an atomic database function. Do not count only completed images in the browser. Enable RLS and deny direct browser access to lifecycle tables; only restricted server functions/service credentials manage them.

Attachment cleanup records must survive deletion of both the trade and the Auth user. Do not give these records cascading foreign keys that erase the only remaining object path. Application RPCs verify parents under the existing owner lock; a reconciliation job removes expired orphan records.

Keep the existing screenshot route URL:

- GET lists only ready attachments; each includes stable `id`, `slot`, private image URL, and image metadata.
- GET of one image verifies journal access, trade ownership, and ready attachment membership before streaming it with the existing private/no-store headers.
- POST accepts one image and the upload ID; validates bytes and dimensions, reserves capacity, uploads, and finalizes. Return the ready attachment and refreshed gallery. Return an existing ready result for an identical retry.
- Concurrent reuse of an upload ID must have one active writer. An in-progress retry gets an explicit retryable status; expired attempts are reconciled before retrying. Do not blindly upload the same object again.
- DELETE identifies the attachment by ID, verifies ownership, and transactionally marks it deleting while recording cleanup work. Ready-list and image reads stop exposing it immediately.
- Retain legacy `?slot=` access as a metadata lookup for migrated images during compatibility rollout; never treat a client-provided object path as authoritative.
- Retain bounded body reading before multipart parsing, existing authorization and origin checks, MIME signature checks, private bucket policy, and server-only service credentials.
- Decode submitted images on the server with an explicitly declared image library, proposed `sharp`, with a pixel limit. Reject malformed/truncated images and unsupported formats; check size again after any server normalization. File names and client MIME declarations are not trusted.
- Use clear errors for unsupported/invalid image (400), unavailable trade (404), capacity/conflicting operation (409), oversized upload (413), throttling (429), and temporary storage failure (503).
- Add a per-owner upload throttle using the existing server infrastructure; keep the slot cap enforced in SQL independently. A proposed starting limit is 30 upload attempts per minute, tuned during preview evaluation.

## 6. Deletion, concurrency, and crash recovery

Storage and Postgres do not share one transaction. Use durable attachment state plus a cleanup outbox rather than depending on a request's final ownership check.

Upload sequence:

1. Receive and validate bounded image data.
2. Reserve an attachment and free slot in a database RPC using the same owner-lock ordering as the current journal mutation dispatcher. Reject missing trades and accounts pending deletion before Storage writes.
3. Upload once to the reserved immutable object path with overwrite disabled. Use a bounded network timeout and upload lease.
4. Finalize in a second RPC, again checking owner deletion state and trade existence under the owner lock. Only then mark the image ready and return Saved.
5. If finalization cannot succeed, leave or mark the reservation for durable cleanup. A process crash is recovered by the scheduled worker.

Deletion sequence:

- Add a database trade-deletion trigger that marks all attachment rows deleting and records exact object paths in the cleanup outbox in the same transaction as trade deletion. A rolled-back trade deletion also rolls back the cleanup request.
- Cover all existing delete sources: single-trade deletion, MT5 account removal with trade purge, manual journal-account deletion where supported, import undo/batch deletion, and full user deletion.
- Removing an MT5 account while retaining its trades must retain the screenshots. Reconnect or sync updates must not clear attachments.
- Integrate the user-deletion preparation step with attachment cleanup so upload finalization is blocked as soon as deletion becomes pending. Cover any remaining attachment rows during full-user deletion, even if their trade is already absent.
- Replace the current route's remove-before-delete sequence. Cleanup must not depend on whether the public screenshots feature flag is enabled.
- Use a scheduled Supabase Edge Function to drain cleanup jobs, proposed every minute, with bounded batches, authenticated invocation, atomic job claiming, retry backoff, and idempotent Storage removal. Track queue age and repeated errors. No user session is required.
- Remove actual objects with the **Storage API**. Do not delete or mutate `storage.objects` rows directly.
- A cleanup job for an uploading attachment must not be marked complete just because an early removal finds no object: an in-flight upload may still arrive. Keep its tombstone through the bounded upload deadline plus a grace period, then perform/verify final cleanup. A delayed finalize must reject a deleting attachment.
- Maintain a periodic paginated reconciliation pass for expired uploads, missing parents, and old unreferenced objects. This recovers interrupted requests and any late Storage completion beyond normal timing bounds. Never sweep active reservations or live ready images; use a conservative age cutoff and exact-path checks.
- Use immutable object paths so a delayed cleanup job for an old screenshot cannot remove a newer image occupying the same display slot.
- Report logical deletion immediately once durably recorded; physical removal is asynchronous and retryable. Initial operating target: normal cleanup within five minutes, with failures visible to operators instead of silently discarded. Do not promise that Storage bytes vanish synchronously with a trade deletion.

## 7. Migration and rollout

1. Work in the existing `feature/journal-trade-images` branch's isolated worktree. Leave unrelated forecast changes in the original checkout alone.
2. Add a forward-only, rerunnable migration for attachment metadata, constraints, narrowly granted lifecycle RPCs, trade/user cleanup integration, and outbox/job claims. Preserve the established account-management lock ordering and hardening migrations.
3. Rehearse against an isolated local Supabase project with disposable users, accounts, trades, and images. Do not use production users for deletion tests.
4. With screenshot uploads disabled, inventory existing bucket objects using paginated reads. Backfill valid old `<user>/<trade>/<slot>` objects into metadata without moving bytes. Report and reconcile orphan/malformed paths. Verify counts before removing any legacy object.
5. Deploy backend and cleanup worker, configure its authenticated schedule, and verify it runs while the public feature is disabled. New writes must not bypass the metadata lifecycle.
6. Deploy the editor/gallery changes with the feature disabled. Run the verification below in preview, including an actual Windows clipboard screenshot.
7. Confirm target-environment bucket privacy, schema, worker health, hosting request-size limits, and server upload deadlines. Set `NEXT_PUBLIC_JOURNAL_SCREENSHOTS_ENABLED=true` for the intended deployment and rebuild/redeploy because this public flag is included in client code.
8. Smoke-test an isolated test account: paste, wait for Saved, reload, reopen, remove, and inspect cleanup completion. Monitor upload failures, finalize failures, stale reservations, queue age, and bucket growth. Do not log image bytes, clipboard content, or credentials.
9. If rollback is needed, disable image intake via the flag and redeploy. Leave cleanup and compatible database lifecycle protections running so already-stored images do not become unmanaged.

## 8. Implementation slices and files

| Slice | Files / deliverable | Exit condition |
| --- | --- | --- |
| A: storage lifecycle | New forward SQL migration and SQL assertions; update `src/lib/screenshots.ts`; cleanup worker and schedule instructions | Atomic capacity, repeatable retries, deletion recovery, legacy inventory/backfill verified |
| B: route integration | Screenshot route, trade delete route, account/user lifecycle integration | Every supported deletion queues cleanup; private reads and writes enforce ownership |
| C: paste/editor | `TradeScreenshots.tsx`, `TradeHistory.tsx`, proposed shared screenshot intake/preparation helper | Paste, picker, preview, autosave, retry/remove, capacity messages, read gallery |
| D: verification and release | Extend `src/lib/__tests__/screenshots.test.ts`; browser/SQL concurrency tests; release runbook | Acceptance checklist passes before enabling the production flag |

Implement A and B before enabling C. No deployment or feature enablement is part of this planning task.

## 9. Verification and acceptance checklist

Browser and user behavior:

- Paste an actual Windows screenshot into the editor; verify Saved, reload, and verify the same trade retains it.
- Repeat with a copied image from a chart/browser and a file picker; exercise Chrome and Edge on Windows. Verify Firefox and Safari/macOS where available; retain the picker for clipboard differences.
- Verify text-only paste in Notes, mixed clipboard behavior, invalid types, no image data, large images, compression readability, full capacity, rapid paste, and multiple clipboard files.
- Verify unsaved/failed upload messaging, Retry, double click/repeated paste, lost response, offline mode, session expiry, trade switching, and editor collapse during upload.
- Verify screenshot autosave survives Cancel of field edits, while unsaved field changes retain their normal behavior. A screenshot must never land on a newly selected trade.
- Verify keyboard focus, accessible status announcements and button labels, mobile layout/picker, and authenticated full-image viewing.
- Automated synthetic paste events cover handler behavior, but do not prove the OS-to-browser clipboard works; retain the real clipboard smoke test.

Server, database, and concurrency:

- Other users and anonymous requests cannot list, upload, fetch, or remove a trade's images; reject cross-origin writes using the existing access guard.
- Enforce server byte/dimension checks, actual image decoding, safe MIME types, bounded request parsing, fixed capacity, and immutable object paths.
- Exercise simultaneous uploads from two tabs: only three active/ready attachments may exist. Same operation retry must not create a second image.
- Race upload reservation and finalization against trade delete, account purge, and user deletion using deterministic connection barriers. Verify lock order and frozen-user rejection.
- Simulate process failure after reservation, after Storage upload, and before/after finalization; the worker must recover without losing a valid ready attachment.
- Simulate cleanup before a delayed upload completes, a worker crash, Storage outage, duplicate worker delivery, expired upload leases, and a newer attachment reusing an old display slot.
- Verify retain-trades account removal preserves images; purge, import undo, and Auth cascades revoke reads and eventually remove bytes. Cleanup records survive Auth deletion and feature disablement.
- Verify legacy object backfill, migration rerun, exact-path cleanup, pagination, and rollback with existing screenshots present.

Run focused unit tests, SQL integration/concurrency checks and the browser suite, then TypeScript, lint, production build, and the existing journal/account regression suites appropriate to these changes. Completed verification is recorded in [LOCAL-RESULTS.md](../tests/screenshots/LOCAL-RESULTS.md).

Completion means a copied desktop screenshot can be pasted and durably saved to the selected trade; it remains private and visible after reopening; failures are recoverable; limits hold across tabs; and deleting its trade or owner cannot leave permanently unmanaged image files.

## 10. Technical references

- [MDN: paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event) describes clipboard access in a user-triggered paste handler and preserving/overriding the default paste action.
- [MDN: DataTransferItem.getAsFile()](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile) describes retrieving clipboard file data.
- [Supabase: delete objects](https://supabase.com/docs/guides/storage/management/delete-objects) requires Storage API deletion; SQL metadata deletion leaves the underlying object behind.
