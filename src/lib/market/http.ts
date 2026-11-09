import 'server-only';

export class ProviderError extends Error {
  constructor(public readonly status?: number, public readonly retryAfterMs = 60_000) {
    super('Market provider request failed');
  }
}

/** One retry for transient transport/502/503/504 failures; never retry 429. */
export async function providerFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000), cache: 'no-store',
        headers: { 'User-Agent': 'MacroFlow/0.1 (market context)', Accept: 'application/json, text/csv, text/calendar, application/xml' },
      });
      if (response.ok) return response;
      if (attempt === 0 && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? '') - Date.now();
      await response.body?.cancel();
      throw new ProviderError(response.status, Number.isFinite(delay) ? Math.max(60_000, Math.min(delay, 86_400_000)) : 60_000);
    } catch (error) {
      if (error instanceof ProviderError || attempt === 1) throw error;
    }
  }
  throw new ProviderError();
}
