import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { admin, assertLocal, createOwner, createTrade, list, login, openEditor, pasteImage } from './helpers';

const width = 3200;
const height = 1800;
const uploadLimit = 3 * 1024 * 1024;

/** Chart-sized fixture with fine background detail, readable labels and candles. */
async function largeChart() {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 0x1234abcd;
  for (let index = 0; index < pixels.length; index += 3) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    pixels[index] = 12 + (seed & 7);
    pixels[index + 1] = 20 + ((seed >>> 3) & 7);
    pixels[index + 2] = 32 + ((seed >>> 6) & 7);
  }
  const elements: string[] = [];
  for (let y = 220; y <= 1540; y += 220) {
    elements.push(`<path d="M90 ${y}H2990" stroke="#304154" stroke-width="1"/>`, `<text x="3020" y="${y + 9}" fill="#d8e0ec" font-size="24">${(2640 - (y - 220) / 22).toFixed(2)}</text>`);
  }
  for (let x = 90; x < 2990; x += 290) elements.push(`<path d="M${x}170V1560" stroke="#304154" stroke-width="1"/>`);
  for (let index = 0; index < 130; index++) {
    const x = 110 + index * 22;
    const center = 1220 - index * 5 + Math.sin(index / 7) * 95;
    const up = index % 5 !== 0;
    const color = up ? '#6ce5c0' : '#ff8492';
    elements.push(`<path d="M${x} ${center - 42}v108" stroke="${color}" stroke-width="2"/><rect x="${x - 6}" y="${center - (up ? 18 : 0)}" width="12" height="40" fill="${color}"/>`);
  }
  elements.push(
    '<rect x="70" y="32" width="1000" height="108" rx="8" fill="#132235"/>',
    '<text x="98" y="78" font-size="32" font-weight="bold" fill="#f2f6ff">XAUUSD · 15m · Screenshot compression check</text>',
    '<text x="98" y="116" font-size="24" fill="#c5d5e8">O 2,608.20   H 2,612.45   L 2,605.80   C 2,610.50</text>',
    '<path d="M90 580H2990" stroke="#6ce5c0" stroke-width="2" stroke-dasharray="12 8"/>',
    '<path d="M90 1000H2990" stroke="#77b9ff" stroke-width="2"/>',
    '<path d="M90 1320H2990" stroke="#ff8492" stroke-width="2" stroke-dasharray="12 8"/>',
    '<rect x="1820" y="525" width="540" height="42" rx="4" fill="#142d2a"/>',
    '<text x="1840" y="555" font-size="26" fill="#83f2ca">Target 2,635.00 · Risk/reward 2.0</text>',
    '<rect x="1820" y="943" width="540" height="42" rx="4" fill="#172b43"/>',
    '<text x="1840" y="973" font-size="26" fill="#a9d3ff">Entry 2,610.50 · Long 0.10 lots</text>',
    '<rect x="1820" y="1263" width="540" height="42" rx="4" fill="#36232c"/>',
    '<text x="1840" y="1293" font-size="26" fill="#ffa3ad">Stop loss 2,598.00 · Risk 12.50</text>',
    '<text x="90" y="1620" font-size="24" fill="#d8e0ec">09:00</text><text x="960" y="1620" font-size="24" fill="#d8e0ec">12:00</text><text x="1830" y="1620" font-size="24" fill="#d8e0ec">15:00</text><text x="2700" y="1620" font-size="24" fill="#d8e0ec">18:00</text>',
    '<text x="90" y="1710" font-size="28" fill="#e8eff8">Breakout above the prior high; wait for a retest before adding.</text>',
  );
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Arial, sans-serif">${elements.join('')}</svg>`);
  return sharp(pixels, { raw: { width, height, channels: 3 } }).composite([{ input: overlay }]).png().toBuffer();
}

test('a large chart PNG is prepared in the browser and stored as a readable WebP within the limit', async ({ page, request }) => {
  await assertLocal(request);
  const artifacts = path.resolve('.artifacts/screenshot-eval/compression');
  mkdirSync(artifacts, { recursive: true });
  const source = await largeChart();
  expect(source.length).toBeGreaterThan(uploadLimit);
  expect(source.length).toBeLessThanOrEqual(20 * 1024 * 1024);
  writeFileSync(path.join(artifacts, 'chart-source.png'), source);
  const owner = await createOwner();
  try {
    await login(page, owner.email);
    const trade = await createTrade(page.request, 'Large chart compression');
    const details = await openEditor(page, trade);
    expect(await pasteImage(page, trade, source)).toBe(true);
    await expect(details.getByText('Saved', { exact: true })).toBeVisible({ timeout: 45_000 });
    const [saved] = await list(page.request, trade);
    expect(saved).toBeDefined();
    const record = await admin.from('journal_trade_screenshots').select('object_path,mime_type,byte_size,width,height,state').eq('id', saved.id).single();
    expect(record.error).toBeNull();
    expect(record.data).toMatchObject({ mime_type: 'image/webp', width, height, state: 'ready' });
    expect(record.data!.byte_size).toBeLessThanOrEqual(uploadLimit);
    const stored = await admin.storage.from('journal-screenshots').download(record.data!.object_path);
    expect(stored.error).toBeNull();
    const output = Buffer.from(await stored.data!.arrayBuffer());
    expect(output.length).toBe(record.data!.byte_size);
    expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width, height });
    writeFileSync(path.join(artifacts, 'chart-stored.webp'), output);
    const crops = [
      { name: 'title', left: 70, top: 32, width: 1080, height: 128 },
      { name: 'entry-and-candles', left: 1740, top: 880, width: 760, height: 220 },
    ];
    for (const crop of crops) {
      const { name, ...region } = crop;
      await sharp(source).extract(region).png().toFile(path.join(artifacts, `${name}-before.png`));
      await sharp(output).extract(region).png().toFile(path.join(artifacts, `${name}-after.png`));
    }
    writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ sourceBytes: source.length, storedBytes: output.length, sourceFormat: 'png', storedFormat: 'webp', width, height, reductionPercent: Math.round((1 - output.length / source.length) * 100) }, null, 2));
    console.log(`Chart preparation: ${source.length} byte PNG -> ${output.length} byte WebP at ${width}x${height}.`);
  } finally {
    await admin.auth.admin.deleteUser(owner.id);
  }
});
