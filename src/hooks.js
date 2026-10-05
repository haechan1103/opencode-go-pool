import { tool } from '@opencode-ai/plugin';
import { classify } from './pool.js';
import { GO_URL } from './config.js';
import { modelConfig, selectedModels } from './catalog.js';

export async function createHooks({ client, directory }, pool) {
  const models = new Map(); const attempts = new Map(); const inflight = new Set();
  pool.start();
  async function toast(message) {
    try { await client.tui.showToast({ body: { title: 'Go Pool', message, variant: 'warning', duration: 6000 } }); } catch {}
  }
  async function fail(sessionID, failure, retrying) {
    const kind = classify(failure);
    if (!kind || inflight.has(sessionID)) return;
    const observed = models.get(sessionID);
    if (!observed) return;
    const settings = await pool.settings();
    if (!settings.enabled || !selectedModels(settings.models)[observed.modelID]) return;
    const current = settings.accounts.find(a => a.providerID === observed.providerID);
    if (!current) return;
    inflight.add(sessionID);
    try {
      await pool.load();
      await pool.failed(current, observed.modelID, kind);
      const response = await client.session.messages({ path: { id: sessionID }, query: { limit: 30 } });
      const list = Array.isArray(response) ? response : response?.data;
      const user = [...(list || [])].reverse().find(m => m.info?.role === 'user');
      if (!user) return;
      const key = `${sessionID}/${user.info.id}`;
      const tried = attempts.get(key) || new Set(); tried.add(current.id); attempts.set(key, tried);
      if (attempts.size > 200) attempts.delete(attempts.keys().next().value);
      const target = await pool.choose(current.providerID, observed.modelID, tried);
      if (!target) { await toast('No available Go account for this request. Check usage and credentials.'); return; }
      tried.add(target.id);
      const parts = (user.parts || []).filter(p => p.type === 'text' || p.type === 'file').map(p => p.type === 'text'
        ? { type: 'text', text: p.text } : { type: 'file', mime: p.mime, url: p.url, ...(p.filename ? { filename: p.filename } : {}) });
      if (!parts.length) return;
      if (retrying) await client.session.abort({ path: { id: sessionID } }).catch(() => {});
      const body = { model: { providerID: target.providerID, modelID: observed.modelID }, parts };
      if (user.info.variant) body.variant = user.info.variant;
      if (user.info.agent || observed.agent) body.agent = user.info.agent || observed.agent;
      // Advance before queuing: immediate errors must be attributed to target.
      models.set(sessionID, { ...observed, providerID: target.providerID });
      const result = await client.session.promptAsync({ path: { id: sessionID }, body });
      if (result?.error) { await toast('Could not queue the Go fallback request.'); return; }
      await pool.used(target);
      await toast(`Go ${current.id} → ${target.id}; ${observed.modelID} retained.`);
    } catch { await toast('Go failover could not complete. No further retry was queued.'); }
    finally { inflight.delete(sessionID); }
  }
  return {
    config: async cfg => {
      const settings = await pool.settings();
      if (!settings.enabled) return;
      const available = selectedModels(settings.models);
      cfg.provider ||= {};
      for (const item of settings.accounts) {
        const key = await pool.key(item);
        if (!key) continue;
        const existing = cfg.provider[item.providerID] || {};
        cfg.provider[item.providerID] = { ...existing, name: `OpenCode Go Pool ${item.id}`, npm: '@ai-sdk/openai-compatible',
          options: { ...existing.options, baseURL: GO_URL, apiKey: key },
          models: Object.fromEntries(Object.entries(available).map(([id, model]) => [id, modelConfig(model)])) };
      }
    },
    'chat.message': async (input, output) => {
      if (!input.sessionID || !output?.message) return;
      const model = output.message.model || input.model;
      if (!model) return;
      models.set(input.sessionID, { ...model, agent: input.agent });
      const settings = await pool.settings();
      if (!settings.accounts.some(a => a.providerID === model.providerID)) return;
      await pool.refresh(); await pool.load();
      const target = await pool.choose(model.providerID, model.modelID);
      if (!target) { await toast('No available Go account. Check usage and credentials.'); return; }
      output.message.model = { providerID: target.providerID, modelID: model.modelID };
      models.set(input.sessionID, { ...output.message.model, agent: input.agent });
      await pool.used(target);
    },
    event: async ({ event }) => {
      try {
        if (event.type === 'server.instance.disposed' && event.properties?.directory === directory) { pool.stop(); models.clear(); attempts.clear(); return; }
        const info = event.properties?.info;
        if (event.type === 'session.deleted') {
          const id = info?.id || event.properties?.sessionID;
          models.delete(id); inflight.delete(id);
          for (const key of attempts.keys()) if (key.startsWith(`${id}/`)) attempts.delete(key);
          return;
        }
        if (event.type === 'message.updated' && info?.role === 'assistant') {
          models.set(info.sessionID, { providerID: info.providerID, modelID: info.modelID, agent: info.agent });
          const item = (await pool.settings()).accounts.find(a => a.providerID === info.providerID);
          if (item) await pool.used(item);
          if (info.error) await fail(info.sessionID, info.error, false);
        }
        if (event.type === 'session.error') await fail(event.properties.sessionID, event.properties.error, false);
        if (event.type === 'session.status' && event.properties?.status?.type === 'retry') {
          await fail(event.properties.sessionID, event.properties.status, true);
        }
      } catch { /* Never print provider error bodies or credentials. */ }
    },
    tool: {
      go_pool_status: tool({ description: 'Show Go account quota and cooldown metadata without keys.', args: {},
        async execute() {
          await pool.refresh(); await pool.load();
          const settings = await pool.settings();
          return JSON.stringify({ accounts: settings.accounts.map(a => ({ id: a.id,
            credential: Boolean(pool.keys.get(a.id)?.value), usage: pool.cache.accounts[a.id] || null,
            cooldown: pool.state.accountLimits[a.id] || null })), modelCooldowns: pool.state.modelLimits });
        } }),
      go_pool_reset: tool({ description: 'Clear error cooldowns; retain actual usage limits and request retry caps.', args: {},
        async execute() { await pool.mutate(state => { state.accountLimits = {}; state.modelLimits = {}; }); return 'Error cooldowns cleared. Known quota and request retry caps remain effective.'; } }),
    },
  };
}
