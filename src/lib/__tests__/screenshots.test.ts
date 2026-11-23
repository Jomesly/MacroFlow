import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

const h = vi.hoisted(() => ({
  auth: vi.fn(), rpc: vi.fn(), owned: true, databaseError: false,
  rows: [] as Record<string, unknown>[], objects: new Map<string, Uint8Array>(),
  uploadError: false, finalizeError: false, finalizeStatus: 'ready', reserveStatus: 'reserved',
  reserveError: '', rateLimited: false, uploads: 0, features: { screenshots: true },
}));
vi.mock('../auth', () => ({ requireJournalAccess: h.auth }));
vi.mock('../journal-features', () => ({ journalFeatures: h.features }));
vi.mock('../screenshot-storage', () => ({
  screenshotBucket: () => ({
    async upload(path: string, bytes: Uint8Array) {
      h.uploads++;
      if (h.uploadError) return { error: { message: 'Storage unavailable' } };
      h.objects.set(path, bytes);
      return { error: null };
    },
    async download(path: string) {
      const bytes = h.objects.get(path);
      return bytes ? { data: new Blob([new Uint8Array(bytes)], { type: 'image/png' }), error: null } : { error: { message: 'Missing' } };
    },
  }),
}));
vi.mock('../supabase', () => ({
  supabase: {
    rpc: h.rpc,
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const result = () => ({
        data: table === 'trades' ? (h.owned ? { id: 'trade' } : null) : h.rows.filter(row => filters.every(f => f(row))),
        error: h.databaseError ? { message: 'Database unavailable' } : null,
      });
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { filters.push(row => row[field] === value); return query; },
        in(field: string, values: unknown[]) { filters.push(row => values.includes(row[field])); return query; },
        order() { return query; },
        async maybeSingle() { const value = result(); return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data }; },
        then(resolve: (value: ReturnType<typeof result>) => void) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  },
}));

import { GET, POST, DELETE } from '../../app/api/journal/trade/[id]/screenshots/route';
import { screenshotContentType, uploadScreenshot } from '../screenshots';

const tradeId = '00000000-0000-4000-8000-000000000001';
const imageId = '00000000-0000-4000-8000-000000000002';
const uploadId = '00000000-0000-4000-8000-000000000003';
const token = '00000000-0000-4000-8000-000000000004';
const owner = '00000000-0000-4000-8000-000000000005';
const path = `${owner}/${tradeId}/${imageId}`;
const context = { params: Promise.resolve({ id: tradeId }) };
const request = (method = 'GET', suffix = '', options: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {}) => new NextRequest(
  `http://localhost:3000/api/journal/trade/${tradeId}/screenshots${suffix}`, { ...options, method },
);
let png: Uint8Array<ArrayBuffer>;
function row(state = 'ready') {
  return { id: imageId, user_id: owner, trade_id: tradeId, slot: 0, object_path: path,
    client_upload_id: uploadId, content_hash: 'hash', mime_type: 'image/png', byte_size: png.length,
    width: 2, height: 2, state, upload_token: token,
    upload_expires_at: new Date(Date.now() + 90_000).toISOString(), created_at: new Date().toISOString() };
}
function imageRequest(bytes: Uint8Array<ArrayBuffer> = png, operation: string | null = uploadId) {
  const body = new FormData();
  body.set('image', new File([bytes], 'chart.exe', { type: 'application/octet-stream' }));
  if (operation !== null) body.set('clientUploadId', operation);
  return request('POST', '', { body });
}

beforeAll(async () => { png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#124578' } }).png().toBuffer()); });
beforeEach(() => {
  vi.clearAllMocks();
  h.features.screenshots = true;
  h.auth.mockResolvedValue({ ok: true, userId: owner });
  h.owned = true; h.databaseError = false; h.rows = []; h.objects.clear(); h.uploads = 0;
  h.uploadError = false; h.finalizeError = false; h.finalizeStatus = 'ready'; h.reserveStatus = 'reserved'; h.reserveError = '';
  h.rateLimited = false;
  h.rpc.mockImplementation(async (name: string) => {
    if (name === 'check_journal_screenshot_upload_rate') return { data: null, error: h.rateLimited ? { message: 'SCREENSHOT_RATE_LIMIT' } : null };
    if (name === 'reserve_journal_screenshot') {
      if (h.reserveError) return { data: null, error: { message: h.reserveError } };
      const existing = h.rows.find(r => r.client_upload_id === uploadId);
      const status = existing?.state === 'ready' ? 'ready' : h.reserveStatus;
      const value = existing ?? row(status === 'ready' ? 'ready' : 'uploading');
      if (!existing) h.rows.push(value);
      return { data: { status, screenshot: value }, error: null };
    }
    if (name === 'finalize_journal_screenshot') {
      if (h.finalizeError) return { error: { message: 'Unknown result' } };
      const value = h.rows[0];
      value.state = h.finalizeStatus === 'ready' ? 'ready' : 'deleting';
      return { data: { status: h.finalizeStatus, screenshot: value }, error: null };
    }
    if (name === 'delete_journal_screenshot') { h.rows.forEach(r => { r.state = 'deleting'; }); return { data: null, error: null }; }
    return { data: null, error: null };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('private journal screenshots', () => {
  it('throttles attempts before expensive image decoding, including invalid-image retries', async () => {
    h.rateLimited = true;
    const response = await POST(imageRequest(png.slice(0, 45)), context);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(h.rows).toHaveLength(0);
  });
  it('requires journal access, ownership, and enabled feature before accepting image data', async () => {
    h.auth.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Sign in' }, { status: 401 }) });
    expect((await POST(imageRequest(), context)).status).toBe(401);
    h.auth.mockResolvedValue({ ok: true, userId: owner }); h.owned = false;
    expect((await POST(imageRequest(), context)).status).toBe(404);
    h.features.screenshots = false;
    expect((await POST(imageRequest(), context)).status).toBe(404);
    expect(h.objects.size).toBe(0);
  });
  it('rejects an image signature with truncated pixel data', async () => {
    const broken = png.slice(0, 45);
    expect(screenshotContentType(broken)).toBe('image/png');
    expect((await POST(imageRequest(broken), context)).status).toBe(400);
    expect(h.objects.size).toBe(0);
  });
  it('rejects unsupported content and oversized bytes before creating a reservation', async () => {
    expect((await POST(imageRequest(new TextEncoder().encode('<svg/>')), context)).status).toBe(400);
    await expect(uploadScreenshot(owner, tradeId, new Uint8Array(3 * 1024 * 1024 + 1), uploadId)).rejects.toMatchObject({ status: 413 });
    expect(h.rows).toHaveLength(0);
  });
  it('rejects oversized decoded dimensions even when compressed file bytes fit', async () => {
    const oversized = new Uint8Array(await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer());
    expect((await POST(imageRequest(oversized), context)).status).toBe(400);
    expect(h.objects.size).toBe(0);
  });
  it('requires a valid retry identity for multipart uploads', async () => {
    expect((await POST(imageRequest(png, null), context)).status).toBe(400);
    expect((await POST(imageRequest(png, '../invalid'), context)).status).toBe(400);
    expect(h.objects.size).toBe(0);
  });
  it('saves valid image bytes with immutable identity and returns only public attachment metadata', async () => {
    const response = await POST(imageRequest(), context);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.screenshot).toMatchObject({ id: imageId, clientUploadId: uploadId, slot: '0', width: 2, height: 2 });
    expect(result.screenshots).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('upload_token');
    expect(JSON.stringify(result)).not.toContain(owner);
    expect(result.screenshot.url).toBe(`/api/journal/trade/${tradeId}/screenshots?imageId=${imageId}`);
    expect(h.objects.get(path)).toEqual(png);
    expect(h.rows[0].state).toBe('ready');
  });
  it.each(['jpeg', 'webp'] as const)('accepts fully decoded %s data independently of its filename', async format => {
    const image = sharp({ create: { width: 2, height: 2, channels: 3, background: '#124578' } });
    const bytes = new Uint8Array(await image[format]().toBuffer());
    const response = await POST(imageRequest(bytes), context);
    expect(response.status).toBe(201);
    expect(h.objects.get(path)).toEqual(bytes);
  });
  it('replays a completed operation without creating or uploading a duplicate', async () => {
    expect((await POST(imageRequest(), context)).status).toBe(201);
    const retry = await POST(imageRequest(), context);
    expect(retry.status).toBe(201);
    expect((await retry.json()).screenshots).toHaveLength(1);
    expect(h.uploads).toBe(1);
  });
  it('reports an in-progress operation without writing its object twice', async () => {
    h.reserveStatus = 'pending';
    const response = await POST(imageRequest(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SCREENSHOT_UPLOAD_PENDING', retryAfter: 2 });
    expect(h.uploads).toBe(0);
  });
  it.each(['expired', 'cancelled'])('allows a new operation only after the old operation is %s', async status => {
    h.reserveStatus = status;
    const response = await POST(imageRequest(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ newUploadRequired: true });
    expect(h.uploads).toBe(0);
  });
  it.each([
    ['SCREENSHOT_LIMIT', 409], ['SCREENSHOT_OPERATION_CONFLICT', 409],
    ['SCREENSHOT_RATE_LIMIT', 429], ['TRADE_NOT_FOUND', 404], ['ACCOUNT_DELETING', 409],
  ])('maps %s to a recoverable API response', async (message, status) => {
    h.reserveError = String(message);
    expect((await POST(imageRequest(), context)).status).toBe(status);
    expect(h.objects.size).toBe(0);
  });
  it('does not announce success if deletion wins before upload finalization', async () => {
    h.finalizeStatus = 'cancelled';
    const response = await POST(imageRequest(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).newUploadRequired).toBe(true);
    expect((await (await GET(request(), context)).json()).screenshots).toHaveLength(0);
  });
  it('keeps an ambiguous failed upload reserved for recovery instead of deleting metadata', async () => {
    h.uploadError = true;
    expect((await POST(imageRequest(), context)).status).toBe(503);
    expect(h.rows[0].state).toBe('uploading');
  });
  it('keeps successfully uploaded bytes recoverable when the final database response is lost', async () => {
    h.finalizeError = true;
    expect((await POST(imageRequest(), context)).status).toBe(503);
    expect(h.objects.get(path)).toEqual(png);
    expect(h.rows[0].state).toBe('uploading');
  });
  it('lists ready screenshots and pending identities without revealing internal paths or tokens', async () => {
    h.rows = [row(), { ...row('uploading'), id: token, client_upload_id: token, slot: 1 },
      { ...row('uploading'), id: owner, client_upload_id: owner, slot: 2, upload_expires_at: '2020-01-01T00:00:00Z' }];
    const result = await (await GET(request(), context)).json();
    expect(result.screenshots).toHaveLength(1);
    expect(result.pendingUploadIds).toEqual([token]);
    expect(JSON.stringify(result)).not.toContain('object_path');
    expect(JSON.stringify(result)).not.toContain('upload_token');
  });
  it('streams only ready private images with no cache, and resolves legacy slots through metadata', async () => {
    h.rows = [row()]; h.objects.set(path, png);
    for (const suffix of [`?imageId=${imageId}`, '?slot=0']) {
      const response = await GET(request('GET', suffix), context);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    }
    h.rows[0].state = 'deleting';
    expect((await GET(request('GET', `?imageId=${imageId}`), context)).status).toBe(404);
  });
  it('durably hides a deleted screenshot before physical Storage cleanup', async () => {
    h.rows = [row()]; h.objects.set(path, png);
    expect((await DELETE(request('DELETE', `?imageId=${imageId}`), context)).status).toBe(204);
    expect((await (await GET(request(), context)).json()).screenshots).toHaveLength(0);
    expect(h.objects.size).toBe(1);
  });
  it('rejects path traversal and ambiguous image selectors', async () => {
    expect((await GET(request('GET', '?imageId=../../someone'), context)).status).toBe(400);
    expect((await DELETE(request('DELETE', '?slot=../../someone'), context)).status).toBe(400);
    expect((await DELETE(request('DELETE', `?imageId=${imageId}&slot=0`), context)).status).toBe(400);
  });
  it('bounds multipart data with and without a trustworthy content length', async () => {
    expect((await POST(request('POST', '', { headers: { 'content-length': String(4 * 1024 * 1024) }, body: 'ignored' }), context)).status).toBe(413);
    expect((await POST(request('POST', '', { body: new Uint8Array(4 * 1024 * 1024) }), context)).status).toBe(413);
    expect(h.objects.size).toBe(0);
  });
});
