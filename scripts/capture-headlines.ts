import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import { RSS_FEEDS } from '../src/lib/api/rss';
import { articleText, classifyHeadline } from '../src/lib/api/classifier';

/**
 * Save the last 24 hours of feed headlines with today's classification, so a
 * trader can label them for src/lib/__tests__/fixtures/headlines-golden.json.
 * Output stays in the ignored .artifacts folder.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DAY_MS = 86_400_000;

const key = (row: { category: string; value: string; symbol?: string }) => [row.category, row.value, row.symbol].filter(Boolean).join(':');

async function main() {
  const parser = new Parser({ headers: { 'User-Agent': UA, Accept: 'application/xml, text/xml, text/html' }, timeout: 15_000 });
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];
  for (const feed of RSS_FEEDS) {
    const url = (feed.envKey && process.env[feed.envKey]) || feed.defaultUrl;
    if (!url) continue;
    try {
      const parsed = await parser.parseURL(url);
      for (const item of parsed.items.slice(0, feed.maxItems)) {
        const published = Date.parse(item.isoDate ?? item.pubDate ?? '');
        if (!Number.isFinite(published) || published > now || now - published > DAY_MS) continue;
        const text = articleText(item.title, item.contentSnippet, 400);
        rows.push({ source: feed.sourceName, publishedAt: new Date(published).toISOString(), url: item.link ?? null,
          title: item.title ?? '', text, classified: classifyHeadline(text).map(key) });
      }
    } catch (error) {
      console.warn(`[capture] ${feed.sourceName} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const file = path.resolve('.artifacts', 'headlines', `${new Date(now).toISOString().slice(0, 10)}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify({ captured: rows.length, classified: rows.filter(row => (row.classified as string[]).length).length, file }));
}

// Feed sockets can stay open after the last read; exit once the file is written.
main().then(() => process.exit(0), error => {
  console.error(error instanceof Error ? error.message : 'Headline capture failed.');
  process.exit(1);
});
