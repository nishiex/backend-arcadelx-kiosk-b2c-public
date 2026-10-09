// Confirm asset resolution works in the two layouts that matter, using the app's own module.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const apiRoot = path.join(repo, 'apps', 'api');

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const probe = path.join(apiRoot, 'audits-probe.mts');
// A relative specifier is required: an absolute Windows path would be read as a URL scheme
// (c:) by the ESM loader. The probe sits beside src/, so this resolves from either cwd.
fs.writeFileSync(probe, `
import fs from 'node:fs';
import { assetFile } from './src/utils/asset-file.ts';
for (const name of ['arcadelx-logo.png', 'invoice-logo.png', 'fonts/Lato-Regular.ttf', 'fonts/Lato-Bold.ttf']) {
  const file = assetFile(name);
  console.log('OK ' + name + ' -> ' + file + ' (' + fs.readFileSync(file).length + ' bytes)');
}
`, 'utf8');

const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// Layout 1: the API's own directory, which is how local development runs.
try {
  const output = execFileSync(process.execPath, [tsx, probe], { cwd: apiRoot, encoding: 'utf8' });
  console.log('--- run from apps/api (local development) ---');
  console.log(output.trim());
  check('local: all four assets resolve', (output.match(/^OK /gm) ?? []).length === 4);
} catch (error) {
  check('local: all four assets resolve', false, String(error.message).slice(0, 160));
}

// Layout 2: the repo root, which is the Vercel working directory.
try {
  const output = execFileSync(process.execPath, [tsx, probe], { cwd: repo, encoding: 'utf8' });
  console.log('--- run from the repo root (Vercel cwd) ---');
  console.log(output.trim());
  check('repo root: all four assets resolve', (output.match(/^OK /gm) ?? []).length === 4);
} catch (error) {
  check('repo root: all four assets resolve', false, String(error.message).slice(0, 160));
}

fs.rmSync(probe, { force: true });
console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
