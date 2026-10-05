#!/usr/bin/env node
import { loadSettings, paths, account, readJSON, writeJSON } from '../src/config.js';
import { credential, saveCredential } from '../src/credentials.js';
import { fetchUsage } from '../src/usage.js';
import { catalog } from '../src/catalog.js';

async function hiddenInput() {
  if (!process.stdin.isTTY) throw new Error('Run add in an interactive terminal. Never pass API keys as arguments.');
  process.stdout.write('Go API key (hidden): ');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', input); process.stdout.write('\n'); };
    const input = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && char !== '\u007f') value += char;
      }
    };
    process.stdin.on('data', input);
  });
}
async function main() {
  const [command = 'help', id, ...extra] = process.argv.slice(2);
  const file = paths().config;
  if (command === 'help' || command === '--help') {
    console.log('opencode-go-pool add ACCOUNT [--replace]\nopencode-go-pool remove ACCOUNT\nopencode-go-pool status\nopencode-go-pool usage [ACCOUNT]\nopencode-go-pool models'); return;
  }
  if (command === 'models') {
    for (const [modelID, model] of Object.entries(catalog.models)) console.log(`${modelID}\t${model.name}\t${model.modalities?.input?.join(',') || 'text'}`);
    return;
  }
  const settings = await loadSettings(file);
  if (command === 'add') {
    if (!id || extra.some(value => value !== '--replace')) throw new Error('Usage: opencode-go-pool add ACCOUNT [--replace]');
    const item = account(id);
    if (!await credential(item) || extra.includes('--replace')) await saveCredential(item, await hiddenInput());
    const raw = await readJSON(file, {});
    raw.accounts = [...new Set([...settings.accounts.map(a => a.id), item.id])];
    await writeJSON(file, raw);
    console.log(`Registered ${item.id}. Restart OpenCode to load its providers.`); return;
  }
  if (command === 'remove') {
    if (!id || extra.length) throw new Error('Usage: opencode-go-pool remove ACCOUNT');
    const raw = await readJSON(file, {});
    raw.accounts = settings.accounts.filter(a => a.id !== account(id).id).map(a => a.id);
    await writeJSON(file, raw);
    console.log('Removed account metadata. Its credential remains in your own credential store.'); return;
  }
  if (command === 'status' || command === 'usage') {
    if (extra.length || (command === 'status' && id)) throw new Error('Unexpected arguments.');
    const items = id ? settings.accounts.filter(a => a.id === account(id).id) : settings.accounts;
    if (!items.length) throw new Error('No registered accounts. Run opencode-go-pool add ACCOUNT.');
    let failed = false;
    for (const item of items) {
      let key = await credential(item);
      console.log(`Go ${item.id}`);
      if (command === 'status') console.log(`  credential: ${key ? 'available' : 'missing'}`);
      else {
        const result = await fetchUsage(key); key = null;
        if (result.error) { console.log(`  ${result.error}`); failed = true; continue; }
        for (const [period, row] of Object.entries(result.usage)) console.log(`  ${period}: used ${row.percent}% / remaining ${100 - row.percent}% | ${row.status} | resets ${new Date(row.resetsAt).toLocaleString()}`);
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }
  throw new Error('Unknown command. Run opencode-go-pool help.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
