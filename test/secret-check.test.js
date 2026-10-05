import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('upload checker rejects a fake secret without printing its value', async () => {
  const root = new URL('../', import.meta.url);
  const fixture = new URL(`secret-check-fixture-${randomUUID()}.txt`, root);
  const fake = ['sk', '-', 'not-a-real-key-', 'Z'.repeat(64)].join('');
  try {
    await writeFile(fixture, fake, { flag: 'wx' });
    const result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], { cwd: fileURLToPath(root), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /possible hardcoded secret/);
    assert.equal((result.stdout + result.stderr).includes(fake), false);
  } finally {
    await unlink(fixture).catch(() => {});
  }
});
