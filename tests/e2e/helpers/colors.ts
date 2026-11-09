import type { Locator } from '@playwright/test';

/** Read rendered sRGB pixels, including CSS color-mix() serialization. */
export async function readColor(locator: Locator, property = 'background-color'): Promise<number[]> {
  return locator.evaluate((element, propertyName) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = getComputedStyle(element).getPropertyValue(propertyName);
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, property);
}

export function contrast(first: number[], second: number[]): number {
  const luminance = (color: number[]) => color.reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
