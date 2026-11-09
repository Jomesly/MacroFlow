import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  owned: vi.fn(),
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  features: { screenshots: true },
}));
vi.mock('../auth', () => ({ requireJournalAccess: h.auth }));
vi.mock('../journal-features', () => ({ journalFeatures: h.features }));
vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ select: h.select }),
    storage: {
      from: () => ({
        list: h.list,
        upload: h.upload,
        remove: h.remove,
        download: h.download,
      }),
    },
  },
}));
import {
  GET,
  POST,
  DELETE,
} from '../../app/api/journal/trade/[id]/screenshots/route';
import { screenshotContentType, uploadScreenshot } from '../screenshots';
const id = '00000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ id }) };
const request = (method = 'GET', suffix = '') =>
  new NextRequest(
    `http://localhost:3000/api/journal/trade/${id}/screenshots${suffix}`,
    { method },
  );
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
beforeEach(() => {
  vi.clearAllMocks();
  h.features.screenshots = true;
  h.auth.mockResolvedValue({ ok: true, userId: 'owner' });
  h.select.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({ eq: h.eq, maybeSingle: h.owned });
  h.owned.mockResolvedValue({ data: { id }, error: null });
  h.list.mockResolvedValue({ data: [], error: null });
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe('private journal screenshots', () => {
  it('checks journal access and owner before storage and rejects disabled uploads', async () => {
    h.auth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Sign in' }, { status: 401 }),
    });
    expect((await GET(request(), context)).status).toBe(401);
    expect(h.list).not.toHaveBeenCalled();
    h.auth.mockResolvedValue({ ok: true, userId: 'other' });
    h.owned.mockResolvedValue({ data: null, error: null });
    expect((await GET(request(), context)).status).toBe(404);
    expect(h.eq).toHaveBeenCalledWith('user_id', 'other');
    expect(h.list).not.toHaveBeenCalled();
    h.features.screenshots = false;
    expect((await POST(request('POST'), context)).status).toBe(404);
  });
  it('checks image signatures, size and fixed slots without trusting file names', async () => {
    expect(
      screenshotContentType(new TextEncoder().encode('<svg/>')),
    ).toBeNull();
    await expect(
      uploadScreenshot('owner', id, new Uint8Array(3 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ status: 413 });
    h.list.mockResolvedValue({ data: [{ name: '0' }], error: null });
    await uploadScreenshot('owner', id, png);
    expect(h.upload).toHaveBeenCalledWith(
      `owner/${id}/1`,
      png,
      expect.objectContaining({ upsert: false, contentType: 'image/png' }),
    );
    h.list.mockResolvedValue({
      data: ['0', '1', '2'].map((name) => ({ name })),
      error: null,
    });
    await expect(uploadScreenshot('owner', id, png)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('streams private images without public links or cache, rejects invalid paths', async () => {
    h.download.mockResolvedValue({
      data: new Blob([png], { type: 'image/png' }),
      error: null,
    });
    const res = await GET(request('GET', '?slot=0'), context);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(
      (await DELETE(request('DELETE', '?slot=../../other'), context)).status,
    ).toBe(400);
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('saves a multipart image and rechecks ownership after upload', async () => {
    const form = new FormData();
    form.set('image', new File([png], 'screenshot.png', { type: 'image/png' }));
    const req = new NextRequest(
      `http://localhost:3000/api/journal/trade/${id}/screenshots`,
      { method: 'POST', body: form },
    );
    expect((await POST(req, context)).status).toBe(201);
    expect(h.owned).toHaveBeenCalledTimes(2);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
  it('bounds the body before parsing form data', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/journal/trade/${id}/screenshots`,
      {
        method: 'POST',
        headers: { 'content-length': String(4 * 1024 * 1024) },
        body: 'ignored',
      },
    );
    expect((await POST(req, context)).status).toBe(413);
    expect(h.upload).not.toHaveBeenCalled();
  });
});
