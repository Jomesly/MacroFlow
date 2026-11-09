import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { journalFeatures } from '@/lib/journal-features';
import {
  listScreenshots,
  readScreenshot,
  removeScreenshots,
  requireOwnedTrade,
  ScreenshotError,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_SLOTS,
  uploadScreenshot,
} from '@/lib/screenshots';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

async function handle(
  request: NextRequest,
  context: Context,
  action: (user: string, id: string) => Promise<Response>,
) {
  if (!journalFeatures.screenshots)
    return NextResponse.json(
      { error: 'Screenshots are not enabled' },
      { status: 404, headers },
    );
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    await requireOwnedTrade(auth.userId, id);
    return await action(auth.userId, id);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ScreenshotError
            ? error.message
            : 'Screenshots are temporarily unavailable',
      },
      {
        status: error instanceof ScreenshotError ? error.status : 503,
        headers,
      },
    );
  }
}

function slotOf(request: NextRequest) {
  const slot = request.nextUrl.searchParams.get('slot');
  if (
    !slot ||
    !SCREENSHOT_SLOTS.includes(slot as (typeof SCREENSHOT_SLOTS)[number])
  )
    throw new ScreenshotError('Invalid screenshot', 400);
  return slot;
}

export async function GET(request: NextRequest, context: Context) {
  return handle(request, context, async (user, id) => {
    if (!request.nextUrl.searchParams.has('slot'))
      return NextResponse.json(
        { screenshots: await listScreenshots(user, id) },
        { headers },
      );
    const image = await readScreenshot(user, id, slotOf(request));
    return new Response(image, {
      headers: {
        ...headers,
        'Content-Type': image.type,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline',
      },
    });
  });
}

export async function POST(request: NextRequest, context: Context) {
  return handle(request, context, async (user, id) => {
    // Read a bounded body before decoding multipart data (also handles absent/false Content-Length).
    const maxBody = SCREENSHOT_MAX_BYTES + 64 * 1024;
    if (Number(request.headers.get('content-length')) > maxBody)
      throw new ScreenshotError('Choose an image up to 3 MB', 413);
    if (!request.body) throw new ScreenshotError('Choose an image', 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBody) {
        await reader.cancel();
        throw new ScreenshotError('Choose an image up to 3 MB', 413);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let form: FormData;
    try {
      form = await new Response(body, {
        headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
      }).formData();
    } catch {
      throw new ScreenshotError('Invalid image upload', 400);
    }
    const file = form.get('image');
    if (!(file instanceof File))
      throw new ScreenshotError('Choose an image', 400);
    const slot = await uploadScreenshot(
      user,
      id,
      new Uint8Array(await file.arrayBuffer()),
    );
    try {
      await requireOwnedTrade(user, id);
    } catch (error) {
      if (error instanceof ScreenshotError && error.status === 404)
        await removeScreenshots(user, id, [slot]);
      throw error;
    }
    return NextResponse.json(
      { screenshots: await listScreenshots(user, id) },
      { status: 201, headers },
    );
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  return handle(request, context, async (user, id) => {
    await removeScreenshots(user, id, [slotOf(request)]);
    return new Response(null, { status: 204, headers });
  });
}
