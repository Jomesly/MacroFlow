import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

export const origin = 'http://localhost:3004';
export const statusPath = process.env.MACROFLOW_SCREENSHOT_TEST_STATUS || path.join(tmpdir(), 'macroflow-screenshot-eval', 'status.json');
export const local = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, string>;
if (local.API_URL !== 'http://127.0.0.1:55721') throw new Error('Screenshot tests require the disposable Supabase project on port 55721.');
export const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export const password = 'MacroFlow-Screenshot-Test-2026!';
export type SavedScreenshot = { id: string; slot: string; url: string; createdAt: string };

export async function assertLocal(request: APIRequestContext) {
  const response = await request.get('/api/account');
  expect(response.headers()['x-macroflow-local-evaluation'], 'Refusing to test outside the isolated local evaluator').toBe('true');
  expect(response.status()).toBe(401);
  const bucket = await admin.storage.getBucket('journal-screenshots');
  expect(bucket.error).toBeNull();
  expect(bucket.data?.public).toBe(false);
}

export async function createOwner() {
  const email = `screenshot-${crypto.randomUUID()}@example.test`;
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(result.error).toBeNull();
  const id = result.data.user!.id;
  const profile = await admin.from('profiles').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', id);
  expect(profile.error).toBeNull();
  return { id, email };
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/journal$/);
}

export async function createTrade(request: APIRequestContext, notes = 'Screenshot test trade') {
  const result = await request.post('/api/journal/trade', {
    headers: { origin },
    data: { symbol: 'XAUUSD', direction: 'long', entryPrice: 2600, exitPrice: 2610, result: 'win', notes },
  });
  expect(result.status(), await result.text()).toBe(201);
  return (await result.json()).trade.id as string;
}

export const endpoint = (trade: string) => `/api/journal/trade/${trade}/screenshots`;
export const png = () => sharp({ create: { width: 640, height: 360, channels: 3, background: '#153e5b' } }).png().toBuffer();

export function upload(request: APIRequestContext, trade: string, buffer: Buffer, clientUploadId = crypto.randomUUID(), mimeType = 'image/png') {
  return request.post(endpoint(trade), {
    headers: { origin },
    multipart: { image: { name: 'chart.png', mimeType, buffer }, clientUploadId },
  });
}

export async function list(request: APIRequestContext, trade: string) {
  const response = await request.get(endpoint(trade));
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).screenshots as SavedScreenshot[];
}

export async function openEditor(page: Page, trade: string) {
  await page.goto('/journal?tab=history');
  const toggle = page.locator(`[aria-controls="trade-details-${trade}"]`);
  await toggle.click();
  const details = page.locator(`#trade-details-${trade}`);
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(details.getByRole('region', { name: 'Trade screenshots' })).toBeVisible();
  await expect(details.locator('input[type="file"]')).toBeEnabled();
  return details;
}

export async function pasteImage(page: Page, trade: string, buffer: Buffer, mime = 'image/png') {
  return page.locator(`#edit-notes-${trade}`).evaluate((element, data) => {
    const binary = atob(data.base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], 'chart.png', { type: data.mime }));
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { base64: buffer.toString('base64'), mime });
}

export async function withNativeClipboard(image: Buffer, action: () => Promise<void>) {
  if (process.platform !== 'win32') throw new Error('Native Windows clipboard verification must run on Windows.');
  const artifacts = path.resolve('.artifacts/screenshot-eval');
  mkdirSync(artifacts, { recursive: true });
  const imagePath = path.join(artifacts, 'native-clipboard-image.png');
  writeFileSync(imagePath, image);
  const helper = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/screenshots/native-clipboard.ps1'), '-ImagePath', imagePath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  helper.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>((resolve, reject) => { helper.once('exit', resolve); helper.once('error', reject); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native clipboard helper did not become ready')), 15_000);
      helper.stdout.on('data', chunk => {
        if (chunk.toString().includes('CLIPBOARD_READY')) { clearTimeout(timeout); resolve(); }
      });
      helper.once('exit', () => { clearTimeout(timeout); reject(new Error(`Native clipboard helper exited before readiness: ${stderr}`)); });
      helper.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    await action();
  } finally {
    helper.stdin.end('\n');
    expect(await exited, stderr).toBe(0);
  }
}
