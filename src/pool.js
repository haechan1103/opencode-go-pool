import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { paths, loadSettings, readJSON, writeJSON, MINUTE } from './config.js';
import { credential } from './credentials.js';
import { fetchUsage, blockedUntil } from './usage.js';
import { selectedModels } from './catalog.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const emptyState = () => ({ active: {}, accountLimits: {}, modelLimits: {} });
export function due(entry, lastUsed, polling, now) {
  const interval = now - (lastUsed || 0) < polling.activeWindowMinutes * MINUTE ? polling.activeMinutes : polling.idleMinutes;
  const lastAttempt = entry?.lastAttempt || 0;
  const reset = blockedUntil(entry);
  return now - lastAttempt >= interval * MINUTE || (reset > 0 && reset <= now && lastAttempt < reset);
}
export function classify(error) {
  const data = error?.data || error || {};
  const code = Number(data.statusCode || error?.statusCode || 0);
  const text = [error?.name, error?.message, data.message, data.responseBody].filter(x => typeof x === 'string').join(' ').slice(0, 4096);
  if (/context length|content filter|invalid model|model not found|invalid parameter|abort/i.test(text)) return null;
  if (code === 401 || code === 403 || /invalid api key|unauthorized|authentication/i.test(text)) return 'auth';
  if (code === 402 || /quota|usage limit|monthly limit|weekly limit|out of credits|plan limit/i.test(text)) return 'quota';
  if (code === 429 || /rate limit|overloaded|too many requests/i.test(text)) return 'rate';
  if (code >= 500 || /timeout|fetch failed|connection reset|network error/i.test(text)) return 'service';
  return null;
}

export class Pool {
  constructor({ files = paths(), options = {}, getCredential = credential, getUsage = fetchUsage, clock = Date.now } = {}) {
    this.files = files; this.options = options; this.getCredential = getCredential; this.getUsage = getUsage; this.clock = clock;
    this.cache = { accounts: {} }; this.state = emptyState(); this.keys = new Map(); this.refreshing = null;
  }
  async settings() {
    const settings = await loadSettings(this.files.config, this.options);
    const registered = new Set(settings.accounts.map(a => a.id));
    for (const id of this.keys.keys()) if (!registered.has(id)) this.keys.delete(id);
    return settings;
  }
  async load() {
    const cache = await readJSON(this.files.usage, { accounts: {} });
    if (!cache || !cache.accounts || typeof cache.accounts !== 'object' || Array.isArray(cache.accounts)) throw new Error('Invalid Go Pool usage metadata.');
    this.cache = cache;
    const state = { ...emptyState(), ...await readJSON(this.files.state, {}) };
    for (const field of ['active', 'accountLimits', 'modelLimits']) {
      if (!state[field] || typeof state[field] !== 'object' || Array.isArray(state[field])) throw new Error('Invalid Go Pool state metadata.');
    }
    this.state = state;
  }
  async key(item) {
    const stored = this.keys.get(item.id);
    if (stored && stored.until > this.clock()) return stored.value;
    const value = await this.getCredential(item);
    this.keys.set(item.id, { value, until: this.clock() + MINUTE });
    return value;
  }
  async lock(file, fn, retry = false) {
    await mkdir(this.files.data, { recursive: true, mode: 0o700 });
    let handle;
    for (let n = 0; n < (retry ? 50 : 1); n++) {
      try {
        const info = await stat(file).catch(() => null);
        if (info && this.clock() - info.mtimeMs > 5 * MINUTE) await unlink(file).catch(() => {});
        handle = await open(file, 'wx', 0o600); break;
      } catch (error) { if (error.code !== 'EEXIST') throw error; if (retry) await sleep(20); }
    }
    if (!handle) return false;
    // Long polls keep the shared lease fresh without retaining OpenCode clients.
    const heartbeat = setInterval(() => { const date = new Date(); void handle.utimes(date, date).catch(() => {}); }, MINUTE);
    heartbeat.unref();
    try { return await fn(); }
    finally { clearInterval(heartbeat); await handle.close(); await unlink(file).catch(() => {}); }
  }
  async mutate(fn) {
    return this.lock(join(this.files.data, 'state.lock'), async () => {
      const state = { ...emptyState(), ...await readJSON(this.files.state, {}) };
      await fn(state);
      for (const field of ['accountLimits', 'modelLimits']) for (const [id, entry] of Object.entries(state[field])) {
        if (entry.until <= this.clock()) delete state[field][id];
      }
      await writeJSON(this.files.state, state); this.state = state; return true;
    }, true);
  }
  async used(item) {
    if (this.clock() - (this.state.active[item.id] || 0) < MINUTE) return;
    await this.mutate(state => { state.active[item.id] = this.clock(); });
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const settings = await this.settings();
      if (!settings.enabled) return;
      await this.load();
      if (!settings.accounts.some(a => due(this.cache.accounts[a.id], this.state.active[a.id], settings.polling, this.clock()))) return;
      await this.lock(this.files.lock, async () => {
        await this.load();
        const work = settings.accounts.filter(a => due(this.cache.accounts[a.id], this.state.active[a.id], settings.polling, this.clock()));
        const results = {};
        // Limit concurrent requests even for large account pools.
        const queue = [...work];
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
          for (let item; (item = queue.shift());) {
            const result = await this.getUsage(await this.key(item));
            results[item.id] = { ...result, checkedAt: this.clock(), lastAttempt: this.clock() };
          }
        }));
        for (const [id, result] of Object.entries(results)) {
          this.cache.accounts[id] = result.usage ? result : { ...this.cache.accounts[id], error: result.error, lastAttempt: result.lastAttempt };
        }
        await writeJSON(this.files.usage, this.cache);
        await this.mutate(state => {
          for (const [id, entry] of Object.entries(results)) {
            if (!entry.usage) continue;
            const limit = state.accountLimits[id];
            if (!limit) continue;
            if (limit.kind === 'auth') delete state.accountLimits[id];
            else if (limit.kind === 'quota') {
              const until = blockedUntil(entry);
              if (until > this.clock()) limit.until = until;
              else delete state.accountLimits[id];
            }
          }
        });
      });
    })().catch(() => { /* Retain known usage on metadata/network failures. */ }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async healthy(item, modelID) {
    if (!await this.key(item)) return false;
    const now = this.clock();
    if ((this.state.accountLimits[item.id]?.until || 0) > now) return false;
    if ((this.state.modelLimits[`${item.id}/${modelID}`]?.until || 0) > now) return false;
    return blockedUntil(this.cache.accounts[item.id]) <= now;
  }
  async choose(providerID, modelID, excluded = new Set()) {
    const settings = await this.settings();
    if (!settings.enabled || !selectedModels(settings.models)[modelID]) return null;
    const current = settings.accounts.find(a => a.providerID === providerID);
    if (!current) return null;
    const start = settings.accounts.indexOf(current);
    for (let offset = 0; offset < settings.accounts.length; offset++) {
      const item = settings.accounts[(start + offset) % settings.accounts.length];
      if (!excluded.has(item.id) && await this.healthy(item, modelID)) return item;
    }
    return null;
  }
  async failed(item, modelID, kind) {
    const { cooldowns } = await this.settings();
    if (!Object.hasOwn(cooldowns, kind)) return;
    await this.mutate(state => {
      const now = this.clock();
      if (kind === 'auth' || kind === 'quota') {
        const reset = kind === 'quota' ? blockedUntil(this.cache.accounts[item.id]) : 0;
        state.accountLimits[item.id] = { kind, until: reset > now ? reset : now + cooldowns[kind] * MINUTE };
      } else state.modelLimits[`${item.id}/${modelID}`] = { kind, until: now + cooldowns[kind] * MINUTE };
    });
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.refresh(); }, MINUTE);
    this.timer.unref(); void this.refresh();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.keys.clear(); }
}
