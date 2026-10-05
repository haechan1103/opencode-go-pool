// Reports only filenames and line numbers, never matched content or values.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let files;
try {
  files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
} catch {
  console.error('Secret check needs the Git source checkout.'); process.exit(1);
}
const sensitiveName = /^(?:\.env(?:\..*)?|.*\.env(?:\..*)?|\.dev\.vars(?:\..*)?|auth\.json|usage\.json|state\.json)$/i;
const patterns = [
  /\b(?:sk-(?:ant-api\d+-)?|xai-|ghp_|github_pat_)[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /["'](?:apiKey|api_key|access_token|refresh_token|password)["']\s*:\s*["'][A-Za-z0-9_+\/.=-]{24,}["']/,
];
let findings = 0;
for (const file of files) {
  // Reject env/credential files before opening them. Env inspection belongs in Kavranta.
  if (sensitiveName.test(basename(file)) || /\.(?:pem|key)$/i.test(file)) {
    console.error(`${file}: sensitive filename; excluded from inspection`); findings++; continue;
  }
  const text = await readFile(new URL(file, new URL('../', import.meta.url)), 'utf8');
  for (const [index, line] of text.split('\n').entries()) {
    if (patterns.some(pattern => pattern.test(line))) {
      console.error(`${file}:${index + 1}: possible hardcoded secret`); findings++;
    }
  }
}
if (findings) { console.error(`FAIL: ${findings} potential exposure findings. Values were not printed.`); process.exit(1); }
console.log(`PASS: ${files.length} Git upload candidates checked; no sensitive filenames or recognized hardcoded secret patterns.`);
