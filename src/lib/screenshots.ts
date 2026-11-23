import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { supabase } from './supabase';
import { screenshotBucket } from './screenshot-storage';

export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
export const SCREENSHOT_MAX_PIXELS = 24_000_000;
export const SCREENSHOT_SLOTS = ['0', '1', '2'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ScreenshotError extends Error {
  constructor(
    message: string,
    public status = 503,
    public code = 'SCREENSHOT_UNAVAILABLE',
    public newUploadRequired = false,
    public retryAfter?: number,
  ) { super(message); }
}

type ScreenshotRow = {
  id: string; user_id: string; trade_id: string; slot: number; object_path: string;
  client_upload_id: string; mime_type: string; byte_size: number;
  width: number; height: number; state: 'uploading' | 'ready' | 'deleting';
  upload_token: string; upload_expires_at: string; created_at: string;
};
type UploadResult = { status: 'reserved' | 'ready' | 'pending' | 'expired' | 'cancelled'; screenshot: ScreenshotRow };
export type ScreenshotSelector = { imageId: string } | { slot: string };
const columns = 'id,user_id,trade_id,slot,object_path,client_upload_id,mime_type,byte_size,width,height,state,upload_expires_at,created_at';

function publicScreenshot(row: ScreenshotRow) {
  return {
    id: row.id, slot: String(row.slot), clientUploadId: row.client_upload_id,
    url: `/api/journal/trade/${row.trade_id}/screenshots?imageId=${row.id}`,
    createdAt: row.created_at, mimeType: row.mime_type,
    byteSize: row.byte_size, width: row.width, height: row.height,
  };
}

function databaseFailure(error: { message: string }): never {
  const code = error.message;
  if (code.includes('SCREENSHOT_LIMIT')) throw new ScreenshotError('This trade already has three screenshots. Remove one to add another.', 409, 'SCREENSHOT_LIMIT');
  if (code.includes('SCREENSHOT_OPERATION_CONFLICT')) throw new ScreenshotError('This upload identity was already used for another image.', 409, 'SCREENSHOT_OPERATION_CONFLICT');
  if (code.includes('SCREENSHOT_RATE_LIMIT')) throw new ScreenshotError('Too many uploads. Wait a minute before trying again.', 429, 'SCREENSHOT_RATE_LIMIT', false, 60);
  if (code.includes('TRADE_NOT_FOUND')) throw new ScreenshotError('Trade not found', 404, 'TRADE_NOT_FOUND');
  if (code.includes('SCREENSHOT_NOT_FOUND')) throw new ScreenshotError('Screenshot unavailable', 404, 'SCREENSHOT_NOT_FOUND');
  if (code.includes('ACCOUNT_DELETING')) throw new ScreenshotError('This account is being deleted. Screenshots cannot be saved.', 409, 'ACCOUNT_DELETING');
  throw new ScreenshotError('Screenshots are temporarily unavailable. Please retry.');
}

function uploadStateFailure(status: UploadResult['status']): never {
  if (status === 'pending') throw new ScreenshotError('This screenshot is still saving. Retry shortly.', 409, 'SCREENSHOT_UPLOAD_PENDING', false, 2);
  if (status === 'expired') throw new ScreenshotError('The upload expired. Retry to save this screenshot again.', 409, 'SCREENSHOT_UPLOAD_EXPIRED', true);
  if (status === 'cancelled') throw new ScreenshotError('This upload was cancelled. Retry to save the screenshot again.', 409, 'SCREENSHOT_UPLOAD_CANCELLED', true);
  throw new ScreenshotError('Screenshot could not be saved. Please retry.');
}

export function screenshotContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function requireOwnedTrade(userId: string, tradeId: string) {
  if (!uuid.test(tradeId)) throw new ScreenshotError('Trade not found', 404, 'TRADE_NOT_FOUND');
  const { data, error } = await supabase.from('trades').select('id').eq('id', tradeId).eq('user_id', userId).maybeSingle();
  if (error) throw new ScreenshotError('Journal storage unavailable');
  if (!data) throw new ScreenshotError('Trade not found', 404, 'TRADE_NOT_FOUND');
}

export async function screenshotGallery(userId: string, tradeId: string) {
  const { data, error } = await supabase.from('journal_trade_screenshots').select(columns)
    .eq('user_id', userId).eq('trade_id', tradeId).in('state', ['ready', 'uploading']).order('slot');
  if (error) databaseFailure(error);
  const rows = (data ?? []) as ScreenshotRow[];
  return {
    screenshots: rows.filter(row => row.state === 'ready').map(publicScreenshot),
    pendingUploadIds: rows.filter(row => row.state === 'uploading' && Date.parse(row.upload_expires_at) > Date.now()).map(row => row.client_upload_id),
  };
}

export type TradeScreenshot = ReturnType<typeof publicScreenshot>;
// Keep each `in (...)` list well inside PostgREST's URL length limit.
const TRADE_ID_BATCH = 150;

/** Saved (ready) screenshots for several of the owner's trades, keyed by trade id. */
export async function screenshotsForTrades(userId: string, tradeIds: string[]): Promise<Map<string, TradeScreenshot[]>> {
  const ids = [...new Set(tradeIds.filter(id => uuid.test(id)))];
  const byTrade = new Map<string, TradeScreenshot[]>();
  for (let start = 0; start < ids.length; start += TRADE_ID_BATCH) {
    const { data, error } = await supabase.from('journal_trade_screenshots').select(columns)
      .eq('user_id', userId).eq('state', 'ready').in('trade_id', ids.slice(start, start + TRADE_ID_BATCH))
      .order('trade_id').order('slot');
    if (error) databaseFailure(error);
    for (const row of (data ?? []) as ScreenshotRow[]) {
      const list = byTrade.get(row.trade_id) ?? [];
      list.push(publicScreenshot(row));
      byTrade.set(row.trade_id, list);
    }
  }
  return byTrade;
}

/** Number of saved screenshots per trade for all of the owner's trades. */
export async function screenshotCountsByTrade(userId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('journal_trade_screenshots').select('trade_id,id')
      .eq('user_id', userId).eq('state', 'ready').order('id').range(offset, offset + 999);
    if (error) databaseFailure(error);
    const page = (data ?? []) as { trade_id: string }[];
    for (const row of page) counts.set(row.trade_id, (counts.get(row.trade_id) ?? 0) + 1);
    if (page.length < 1000) break;
  }
  return counts;
}

async function findScreenshot(userId: string, tradeId: string, selector: ScreenshotSelector) {
  let query = supabase.from('journal_trade_screenshots').select(columns)
    .eq('user_id', userId).eq('trade_id', tradeId).eq('state', 'ready');
  query = 'imageId' in selector ? query.eq('id', selector.imageId) : query.eq('slot', Number(selector.slot));
  const { data, error } = await query.maybeSingle();
  if (error) databaseFailure(error);
  if (!data) throw new ScreenshotError('Screenshot unavailable', 404, 'SCREENSHOT_NOT_FOUND');
  return data as ScreenshotRow;
}

export async function readScreenshot(userId: string, tradeId: string, selector: ScreenshotSelector) {
  const row = await findScreenshot(userId, tradeId, selector);
  const { data, error } = await screenshotBucket().download(row.object_path);
  if (error || !data) throw new ScreenshotError('Screenshot unavailable', 404, 'SCREENSHOT_NOT_FOUND');
  return new Blob([data], { type: row.mime_type });
}

async function validateImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > SCREENSHOT_MAX_BYTES) throw new ScreenshotError('Choose an image up to 3 MiB.', 413, 'SCREENSHOT_TOO_LARGE');
  const mimeType = screenshotContentType(bytes);
  if (!mimeType) throw new ScreenshotError('Choose a PNG, JPEG or WebP image.', 400, 'SCREENSHOT_INVALID_IMAGE');
  try {
    const image = sharp(bytes, { limitInputPixels: SCREENSHOT_MAX_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > SCREENSHOT_MAX_PIXELS || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image dimensions or animation');
    }
    // Reading metadata alone does not validate pixel data; fully decode the image.
    await image.raw().toBuffer();
    return { mimeType, width: metadata.width, height: metadata.height };
  } catch {
    throw new ScreenshotError('Choose a valid, still PNG, JPEG or WebP image up to 24 megapixels.', 400, 'SCREENSHOT_INVALID_IMAGE');
  }
}

export async function uploadScreenshot(userId: string, tradeId: string, bytes: Uint8Array, clientUploadId: string) {
  const rate = await supabase.rpc('check_journal_screenshot_upload_rate', { p_user_id: userId });
  if (rate.error) databaseFailure(rate.error);
  if (typeof clientUploadId !== 'string' || !uuid.test(clientUploadId)) throw new ScreenshotError('Invalid screenshot upload identity.', 400, 'SCREENSHOT_INVALID_UPLOAD_ID');
  const image = await validateImage(bytes);
  const { data, error } = await supabase.rpc('reserve_journal_screenshot', {
    p_user_id: userId, p_trade_id: tradeId, p_client_upload_id: clientUploadId,
    p_content_hash: createHash('sha256').update(bytes).digest('hex'),
    p_mime_type: image.mimeType, p_byte_size: bytes.length, p_width: image.width, p_height: image.height,
  });
  if (error) databaseFailure(error);
  if (!data) throw new ScreenshotError('Screenshot could not be reserved. Please retry.');
  const reservation = data as UploadResult;
  if (reservation.status === 'ready') return publicScreenshot(reservation.screenshot);
  if (reservation.status !== 'reserved') uploadStateFailure(reservation.status);
  const row = reservation.screenshot;
  const operation = { p_user_id: userId, p_trade_id: tradeId, p_image_id: row.id, p_upload_token: row.upload_token };
  if (Date.parse(row.upload_expires_at) <= Date.now()) {
    await supabase.rpc('abort_journal_screenshot', operation);
    uploadStateFailure('expired');
  }
  // An ambiguous network failure leaves the reservation intact. Its expiry and
  // cleanup outbox recover bytes that arrive after the request has disappeared.
  const uploaded = await screenshotBucket().upload(row.object_path, bytes, {
    contentType: image.mimeType, cacheControl: '0', upsert: false,
  });
  if (uploaded.error) throw new ScreenshotError('Screenshot could not be saved. Retry to check its status.');
  const finalized = await supabase.rpc('finalize_journal_screenshot', operation);
  if (finalized.error) databaseFailure(finalized.error);
  if (!finalized.data) throw new ScreenshotError('Screenshot save could not be confirmed. Please retry.');
  const result = finalized.data as UploadResult;
  if (result.status !== 'ready') uploadStateFailure(result.status);
  return publicScreenshot(result.screenshot);
}

export async function removeScreenshot(userId: string, tradeId: string, selector: ScreenshotSelector) {
  const imageId = 'imageId' in selector ? selector.imageId : (await findScreenshot(userId, tradeId, selector)).id;
  const { error } = await supabase.rpc('delete_journal_screenshot', { p_user_id: userId, p_trade_id: tradeId, p_image_id: imageId });
  if (error) databaseFailure(error);
}
