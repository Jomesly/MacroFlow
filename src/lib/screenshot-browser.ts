export const SCREENSHOT_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type ClipboardData = {
  items?: ArrayLike<Pick<DataTransferItem, 'kind' | 'type' | 'getAsFile'>>;
  files?: ArrayLike<File>;
};

/** Image-only handling lets ordinary text paste keep its native behavior. */
export function clipboardImages(data: ClipboardData | null): File[] {
  if (!data) return [];
  if (data.items?.length) {
    return Array.from(data.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  return Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'));
}

export function imageUploadError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!IMAGE_TYPES.has(file.type)) return 'Choose a PNG, JPEG or WebP image.';
  if (!file.size) return 'This image is empty. Copy or choose another screenshot.';
  if (file.size > MAX_SOURCE_BYTES) return 'Choose a source image up to 20 MiB.';
  return null;
}

/** Local drafts can already have a server reservation after a lost response. */
export function screenshotCapacity(saved: number, draftIds: readonly string[], pendingIds: readonly string[]): number {
  return Math.max(0, 3 - saved - new Set([...draftIds, ...pendingIds]).size);
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Image decode failed'));
        image.src = url;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  } catch {
    throw new Error('This screenshot could not be read. Copy or choose another image.');
  }
}

function webp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.type === 'image/webp') resolve(blob);
      else reject(new Error('This browser cannot prepare this large image. Crop it or choose a smaller image.'));
    }, 'image/webp', quality);
  });
}

/** Keep small images intact; compress larger images only above a readable quality floor. */
export async function prepareScreenshot(file: File): Promise<File> {
  const error = imageUploadError(file);
  if (error) throw new Error(error);
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_PIXELS) {
      throw new Error('Choose a screenshot with no more than 24 megapixels.');
    }
    if (file.size <= SCREENSHOT_UPLOAD_BYTES) return file;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the screenshot. Choose a smaller image.');
    const reduced = Math.min(1, 4096 / Math.max(decoded.width, decoded.height));
    for (const scale of reduced < 1 ? [1, reduced] : [1]) {
      canvas.width = Math.round(decoded.width * scale);
      canvas.height = Math.round(decoded.height * scale);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.95, 0.9, 0.85]) {
        const blob = await webp(canvas, quality);
        if (blob.size <= SCREENSHOT_UPLOAD_BYTES) {
          return new File([blob], 'screenshot.webp', { type: blob.type });
        }
      }
    }
    throw new Error('This screenshot is too large. Crop it or choose a smaller image.');
  } finally {
    decoded.close();
  }
}
