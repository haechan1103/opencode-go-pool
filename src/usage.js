import { GO_URL } from './config.js';

export function parseUsage(body) {
  if (!body || typeof body.usage !== 'object') throw new Error('Invalid usage response.');
  const result = {};
  for (const period of ['rolling', 'weekly', 'monthly']) {
    const row = body.usage[period];
    if (!row || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100 ||
      !['ok', 'rate-limited'].includes(row.status) || typeof row.resetsAt !== 'string' ||
      !Number.isFinite(Date.parse(row.resetsAt))) throw new Error('Invalid usage response.');
    result[period] = { percent: row.percent, status: row.status, resetsAt: new Date(row.resetsAt).toISOString() };
  }
  return result;
}
export async function fetchUsage(key, fetcher = fetch) {
  if (!key) return { error: 'missing-credential' };
  try {
    const response = await fetcher(`${GO_URL}/usage`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { await response.body?.cancel(); return { error: `http-${response.status}` }; }
    // Bound reads, including chunked responses. Do not return provider bodies.
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) { await reader.cancel(); return { error: 'invalid-response' }; }
      chunks.push(Buffer.from(value));
    }
    return { usage: parseUsage(JSON.parse(Buffer.concat(chunks).toString('utf8'))) };
  } catch { return { error: 'query-failed' }; }
}
export function blockedUntil(entry) {
  return Math.max(0, ...Object.values(entry?.usage || {}).filter(p => p.status === 'rate-limited' || p.percent >= 100)
    .map(p => Date.parse(p.resetsAt) || 0));
}
