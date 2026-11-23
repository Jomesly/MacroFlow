import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clipboardImages,
  imageUploadError,
  prepareScreenshot,
  screenshotCapacity,
} from '../screenshot-browser';

afterEach(() => vi.unstubAllGlobals());

describe('clipboard screenshot intake', () => {
  const image = () => new File(['image'], 'chart.png', { type: 'image/png' });

  it('extracts image files once when the clipboard exposes both items and files', () => {
    const file = image();
    const clipboard = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => file },
      ],
      files: [file],
    };
    expect(clipboardImages(clipboard)).toEqual([file]);
  });

  it('leaves text and HTML-only paste alone and handles files-only browser data', () => {
    expect(clipboardImages({ items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }], files: [] })).toEqual([]);
    const file = image();
    expect(clipboardImages({ items: [], files: [file] })).toEqual([file]);
  });

  it('returns unsupported image types so callers can explain rejection without pasting binary data', () => {
    const file = new File(['<svg/>'], 'chart.svg', { type: 'image/svg+xml' });
    expect(clipboardImages({ items: [{ kind: 'file', type: file.type, getAsFile: () => file }], files: [] })).toEqual([file]);
    expect(imageUploadError(file)).toContain('PNG, JPEG or WebP');
    expect(imageUploadError(new File([], 'empty.png', { type: 'image/png' }))).toContain('empty');
    expect(imageUploadError({ size: 21 * 1024 * 1024, type: 'image/png' })).toContain('20 MiB');
  });

  it('counts local queue entries and server reservations once against the three-slot limit', () => {
    expect(screenshotCapacity(1, ['first', 'second'], ['first'])).toBe(0);
    expect(screenshotCapacity(1, ['first'], ['first'])).toBe(1);
    expect(screenshotCapacity(3, [], [])).toBe(0);
    expect(screenshotCapacity(0, [], ['another-tab'])).toBe(2);
  });
});

describe('screenshot preparation', () => {
  it('preserves valid small images without recompression and closes the decoded bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1200, height: 800, close }));
    const file = new File(['valid bytes'], 'chart.png', { type: 'image/png' });
    expect(await prepareScreenshot(file)).toBe(file);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects unreadable images and excessive decoded dimensions', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const file = new File(['broken'], 'chart.png', { type: 'image/png' });
    await expect(prepareScreenshot(file)).rejects.toThrow('could not be read');
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 8000, height: 4000, close }));
    await expect(prepareScreenshot(file)).rejects.toThrow('24 megapixels');
    expect(close).toHaveBeenCalledOnce();
  });

  it('compresses an oversized screenshot to WebP without upscaling it', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: (blob: Blob) => void) => done(new Blob(['small webp'], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1600, height: 1000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const file = new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'chart.png', { type: 'image/png' });
    const prepared = await prepareScreenshot(file);
    expect(prepared.type).toBe('image/webp');
    expect(prepared.size).toBeLessThan(3 * 1024 * 1024);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1000);
    expect(close).toHaveBeenCalledOnce();
  });

  it('stops rather than degrading chart text below the quality floor', async () => {
    const qualities: number[] = [];
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob) => void, _type: string, quality: number) => { qualities.push(quality); done(new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: 'image/webp' })); } };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 6000, height: 3000, close: vi.fn() }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const file = new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'chart.png', { type: 'image/png' });
    await expect(prepareScreenshot(file)).rejects.toThrow('Crop it');
    expect(Math.min(...qualities)).toBe(0.85);
    expect(canvas.width).toBe(4096);
    expect(canvas.height).toBe(2048);
  });
});
