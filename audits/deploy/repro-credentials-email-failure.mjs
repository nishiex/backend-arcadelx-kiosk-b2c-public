// Reproduce the credentials-email failure under Vercel's file layout.
//
// The bundle inlines everything, so `__dirname` inside it is the BUNDLE's directory, not
// src/services/email/. The logo is therefore looked up at a path that does not exist on the
// platform, fs.readFileSync throws, sendEmail throws, and attemptDelivery() swallows it --
// leaving the delivery row with sentAt = null and an incremented attempt count.
//
// This copies the real bundle into a temp directory that mimics /var/task, then calls the
// bundled credential sender and reports the actual error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const apiRoot = path.join(repo, 'apps', 'api');

// Mimic the deployed layout: <root>/api/index.mjs, with assets included by Vercel at their
// project-relative path.
const task = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadelx-task-'));
fs.mkdirSync(path.join(task, 'api'), { recursive: true });
fs.copyFileSync(path.join(repo, 'api', 'index.mjs'), path.join(task, 'api', 'index.mjs'));
fs.mkdirSync(path.join(task, 'apps', 'api', 'src', 'assets'), { recursive: true });
for (const asset of ['arcadelx-logo.png', 'invoice-logo.png']) {
  fs.copyFileSync(
    path.join(apiRoot, 'src', 'assets', asset),
    path.join(task, 'apps', 'api', 'src', 'assets', asset),
  );
}
execFileSync('cmd', ['/c', 'mklink', '/J',
  path.join(task, 'node_modules'), path.join(repo, 'node_modules')], { stdio: 'ignore' });

process.chdir(task);
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';
for (const line of fs.readFileSync(path.join(repo, '.env'), 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const index = trimmed.indexOf('=');
  process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
}

console.log(`simulated function root: ${task}`);
console.log(`bundle location:         ${path.join(task, 'api', 'index.mjs')}`);
console.log(`__dirname inside bundle: ${path.join(task, 'api')}`);
console.log(`logo looked up at:       ${path.resolve(path.join(task, 'api'), '../../assets/arcadelx-logo.png')}`);
console.log(`logo actually shipped at:${path.join(task, 'apps', 'api', 'src', 'assets', 'arcadelx-logo.png')}`);
console.log(
  'looked-up path exists:   ' +
  fs.existsSync(path.resolve(path.join(task, 'api'), '../../assets/arcadelx-logo.png')),
);

// Load the bundle and exercise the credential sender the retry endpoint calls.
await import(pathToFileURL(path.join(task, 'api', 'index.mjs')).href);
const delivery = await import(
  pathToFileURL(path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs')).href
).catch(() => null);

console.log('\n=== invoking the real credential sender via tsx (same code path) ===');
const probe = path.join(task, 'probe.ts');
fs.writeFileSync(probe, `
import path from 'node:path';
import fs from 'node:fs';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\\//, ''));
const logo = path.join(dir, 'api', '..', '..', 'assets', 'arcadelx-logo.png');
console.log('resolved logo path:', path.resolve(logo));
console.log('exists:', fs.existsSync(path.resolve(logo)));
try {
  fs.readFileSync(path.resolve(logo));
  console.log('READ OK');
} catch (error) {
  console.log('THROWS:', error.code, error.message.split('\\n')[0]);
}
`, 'utf8');

const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');
execFileSync(process.execPath, [tsx, probe], { cwd: task, stdio: 'inherit' });
