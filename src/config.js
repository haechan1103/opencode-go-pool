import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const GO_URL = 'https://opencode.ai/zen/go/v1';
export const MINUTE = 60_000;
export function paths(env = process.env) {
  const home = homedir();
  const configRoot = env.XDG_CONFIG_HOME || (process.platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming') : join(home, '.config'));
  const dataRoot = env.XDG_DATA_HOME || (process.platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local') : join(home, '.local', 'share'));
  const data = join(dataRoot, 'opencode-go-pool');
  return { config: env.OPENCODE_GO_POOL_CONFIG || join(configRoot, 'opencode', 'go-pool.json'),
    data, usage: join(data, 'usage.json'), state: join(data, 'state.json'), lock: join(data, 'usage.lock') };
}
export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Cannot read Go Pool metadata.'); }
}
export async function writeJSON(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}
export function account(id) {
  id = String(id).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(id)) throw new Error('Account ID must start with a letter and contain only letters, digits, or underscores.');
  return { id, providerID: `opencode-go-pool-${id.toLowerCase()}`, env: `OPENCODE_GO_KEY_${id}` };
}
export async function loadSettings(file, overrides = {}) {
  const raw = { ...await readJSON(file, {}), ...overrides };
  const ids = raw.accounts || [];
  if (!Array.isArray(ids) || ids.length > 100) throw new Error('accounts must be an array of at most 100 account IDs.');
  const accounts = [...new Set(ids.map(id => account(id).id))].map(account);
  const timings = { idleMinutes: 60, activeMinutes: 10, activeWindowMinutes: 20, ...raw.polling };
  for (const value of Object.values(timings)) if (!Number.isFinite(value) || value < 1 || value > 1440) throw new Error('Polling intervals must be between 1 and 1440 minutes.');
  if (raw.cooldowns !== undefined && (!raw.cooldowns || typeof raw.cooldowns !== 'object' || Array.isArray(raw.cooldowns))) throw new Error('cooldowns must be an object of minute values.');
  const cooldowns = { quota: 10, auth: 15, rate: 5, service: 2, ...raw.cooldowns };
  for (const [kind, value] of Object.entries(cooldowns)) {
    if (!['quota', 'auth', 'rate', 'service'].includes(kind) || !Number.isFinite(value) || value < 1 || value > 1440) throw new Error('Cooldowns must use quota/auth/rate/service with values between 1 and 1440 minutes.');
  }
  if (raw.models !== undefined && (!Array.isArray(raw.models) || raw.models.some(id => typeof id !== 'string'))) throw new Error('models must be an array of model IDs.');
  return { enabled: raw.enabled !== false, accounts, models: raw.models, polling: timings, cooldowns };
}
