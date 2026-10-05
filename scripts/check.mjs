import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const folder of ['src', 'bin', 'scripts']) for (const file of await readdir(new URL(`../${folder}/`, import.meta.url))) {
  if (!/\.(js|mjs)$/.test(file)) continue;
  const result = spawnSync(process.execPath, ['--check', new URL(`../${folder}/${file}`, import.meta.url).pathname], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
