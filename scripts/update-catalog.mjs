import { parse } from 'smol-toml';
import { writeFile } from 'node:fs/promises';
const requested = process.env.MODELS_DEV_REF || 'dev';
const revision = await fetch(`https://api.github.com/repos/anomalyco/models.dev/commits/${requested}`, { signal: AbortSignal.timeout(30_000) }).then(r => r.json()).then(r => r.sha);
if (!revision) throw new Error('Cannot resolve model catalog revision.');
const base = `https://raw.githubusercontent.com/anomalyco/models.dev/${revision}/`;
async function text(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cannot fetch catalog file: ${path}`);
  return response.text();
}
const manifest = await fetch(`https://api.github.com/repos/anomalyco/models.dev/contents/providers/opencode-go/models?ref=${revision}`, { signal: AbortSignal.timeout(30_000) }).then(r => r.json());
if (!Array.isArray(manifest)) throw new Error('Cannot list Go catalog.');
const provider = parse(await text('providers/opencode-go/provider.toml'));
const models = {};
for (const file of manifest.filter(f => f.name.endsWith('.toml'))) {
  const override = parse(await text(`providers/opencode-go/models/${file.name}`));
  const parent = override.base_model ? parse(await text(`models/${override.base_model}.toml`)) : {};
  const data = { ...parent, ...override };
  const id = file.name.slice(0, -5);
  const model = {};
  for (const key of ['name', 'family', 'release_date', 'attachment', 'reasoning', 'temperature', 'tool_call', 'limit', 'modalities', 'interleaved', 'status', 'structured_output']) {
    if (data[key] !== undefined) model[key] = data[key];
  }
  const npm = data.provider?.npm || provider.npm;
  model.provider = { npm, api: data.provider?.api || provider.api };
  const price = data.cost || {};
  model.cost = { input: price.input || 0, output: price.output || 0 };
  for (const key of ['cache_read', 'cache_write', 'context_over_200k']) if (price[key] !== undefined) model.cost[key] = price[key];
  // OpenCode v1 config supports one >200k tier; do not invent a different threshold.
  model.variants = { medium: { disabled: true }, low: { disabled: true }, high: { disabled: true }, max: { disabled: true } };
  const controls = data.reasoning_options || [];
  const effort = controls.find(c => c.type === 'effort');
  if (effort) for (const value of effort.values) {
    const name = value === null ? 'none' : value;
    let options;
    if (npm === '@ai-sdk/anthropic') options = { effort: name, thinking: { type: 'adaptive' } };
    else if (npm === '@ai-sdk/openai') options = { reasoningEffort: name, reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] };
    else options = { reasoningEffort: name };
    model.variants[name] = options;
  }
  if (!effort && controls.some(c => c.type === 'toggle') && id.includes('minimax-m3')) {
    model.variants.none = { thinking: { type: 'disabled' } };
    model.variants.thinking = { thinking: { type: 'adaptive' } };
  }
  if (!effort && controls.some(c => c.type === 'budget_tokens') && npm === '@ai-sdk/anthropic') {
    const budget = controls.find(c => c.type === 'budget_tokens');
    const maximum = Math.min(budget.max || 31_999, (model.limit?.output || 32_000) - 1, 31_999);
    model.variants.high = { thinking: { type: 'enabled', budgetTokens: Math.floor(maximum / 2) } };
    model.variants.max = { thinking: { type: 'enabled', budgetTokens: maximum } };
  }
  models[id] = model;
}
await writeFile(new URL('../catalog/go-models.json', import.meta.url), JSON.stringify({ source: 'anomalyco/models.dev/providers/opencode-go', revision, updatedAt: new Date().toISOString(), models }, null, 2) + '\n');
console.log(`Updated ${Object.keys(models).length} Go model definitions.`);
