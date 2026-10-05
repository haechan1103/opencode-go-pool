import { readFile } from 'node:fs/promises';
export const catalog = JSON.parse(await readFile(new URL('../catalog/go-models.json', import.meta.url), 'utf8'));
export function selectedModels(ids) {
  if (!ids) return catalog.models;
  for (const id of ids) if (!catalog.models[id]) throw new Error(`Unknown Go model: ${id}. Run opencode-go-pool models.`);
  return Object.fromEntries(ids.map(id => [id, catalog.models[id]]));
}
export function modelConfig(model) {
  const config = structuredClone(model);
  delete config.structured_output;
  return config;
}
