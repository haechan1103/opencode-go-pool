import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
const exec = promisify(execFile);
const quote = value => '"' + String(value).replace(/[\\"]/g, '\\$&') + '"';
export async function credential(account, { env = process.env, platform = process.platform } = {}) {
  if (env[account.env]) return env[account.env];
  if (platform !== 'darwin') return null;
  try {
    const { stdout } = await exec('security', ['find-generic-password', '-a', env.USER || userInfo().username, '-s', account.env, '-w'],
      { timeout: 15_000, maxBuffer: 16_384 });
    return stdout.replace(/[\r\n]+$/, '') || null;
  } catch { return null; }
}
async function keychainCommand(command) {
  // Secret travels via stdin, not command-line arguments or a plaintext file.
  await new Promise((resolve, reject) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Keychain operation timed out.')); }, 15_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Keychain operation failed.')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Keychain operation failed.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(command + '\n');
  });
}
export async function saveCredential(account, key) {
  if (process.platform !== 'darwin') throw new Error(`Set ${account.env} in your own environment. Keychain storage is macOS-only.`);
  if (!key || /[\r\n\0]/.test(key)) throw new Error('Key must be a non-empty single line.');
  await keychainCommand(`add-generic-password -a ${quote(process.env.USER || userInfo().username)} -s ${quote(account.env)} -w ${quote(key)} -U`);
  // Never print subprocess output or credential contents.
  if (await credential(account, { env: { USER: process.env.USER } }) !== key) throw new Error('Could not verify Keychain storage.');
}
