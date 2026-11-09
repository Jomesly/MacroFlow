import 'server-only';
import { supabase } from './supabase';

export const SCREENSHOT_BUCKET = 'journal-screenshots';
export const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
export const SCREENSHOT_SLOTS = ['0', '1', '2'] as const;
export class ScreenshotError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}

export function screenshotContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return 'image/png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export async function requireOwnedTrade(userId: string, tradeId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tradeId,
    )
  )
    throw new ScreenshotError('Trade not found', 404);
  const { data, error } = await supabase
    .from('trades')
    .select('id')
    .eq('id', tradeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new ScreenshotError('Journal storage unavailable');
  if (!data) throw new ScreenshotError('Trade not found', 404);
}

const bucket = () => supabase.storage.from(SCREENSHOT_BUCKET);
const folder = (userId: string, tradeId: string) =>
  `${userId.toLowerCase()}/${tradeId.toLowerCase()}`;
export async function listScreenshots(userId: string, tradeId: string) {
  const prefix = folder(userId, tradeId);
  const { data, error } = await bucket().list(prefix, { limit: 10 });
  if (error)
    throw new ScreenshotError('Screenshots are temporarily unavailable');
  return (data ?? [])
    .filter((f) =>
      SCREENSHOT_SLOTS.includes(f.name as (typeof SCREENSHOT_SLOTS)[number]),
    )
    .map((f) => ({
      slot: f.name,
      url: `/api/journal/trade/${tradeId}/screenshots?slot=${f.name}`,
      createdAt: f.created_at,
    }));
}

export async function readScreenshot(
  userId: string,
  tradeId: string,
  slot: string,
) {
  const { data, error } = await bucket().download(
    `${folder(userId, tradeId)}/${slot}`,
  );
  if (error || !data) throw new ScreenshotError('Screenshot unavailable', 404);
  return data;
}

export async function uploadScreenshot(
  userId: string,
  tradeId: string,
  bytes: Uint8Array,
) {
  if (!bytes.length || bytes.length > SCREENSHOT_MAX_BYTES)
    throw new ScreenshotError('Choose an image up to 3 MB', 413);
  const contentType = screenshotContentType(bytes);
  if (!contentType)
    throw new ScreenshotError('Choose a PNG, JPEG or WebP image', 400);
  const existing = await listScreenshots(userId, tradeId);
  const free = SCREENSHOT_SLOTS.filter(
    (slot) => !existing.some((f) => f.slot === slot),
  );
  for (const slot of free) {
    const { error } = await bucket().upload(
      `${folder(userId, tradeId)}/${slot}`,
      bytes,
      { contentType, upsert: false, cacheControl: '0' },
    );
    if (!error) return slot;
    // Concurrent uploads compete for the same three fixed slots; never overwrite.
    if (
      !['409', '400'].includes(
        String((error as { statusCode?: string }).statusCode),
      ) ||
      !/duplicate|already exists/i.test(error.message)
    )
      throw new ScreenshotError('Screenshot could not be saved');
  }
  throw new ScreenshotError('This trade already has three screenshots', 409);
}

export async function removeScreenshots(
  userId: string,
  tradeId: string,
  slots: readonly string[] = SCREENSHOT_SLOTS,
) {
  const { error } = await bucket().remove(
    slots.map((slot) => `${folder(userId, tradeId)}/${slot}`),
  );
  if (error) throw new ScreenshotError('Screenshot could not be removed');
}
