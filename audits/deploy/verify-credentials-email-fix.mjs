// Verify the credential-email asset fix in a simulated Vercel function layout.
//
// Before the fix, `__dirname` inside the bundle pointed at <root>/api, so the logo resolved to
// <root>/../assets -- outside the function root -- and fs.readFileSync threw ENOENT, which made
// every credential resend fail silently.
//
// This stages the real bundle plus its shipped assets and confirms assetFile() resolves, the
// base64 payload is produced, and the Mailjet send chain accepts the message. SandboxMode is
// used so nothing is delivered.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';

const task = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadelx-fixed-'));
fs.mkdirSync(path.join(task, 'api'), { recursive: true });
fs.copyFileSync(path.join(repo, 'api', 'index.mjs'), path.join(task, 'api', 'index.mjs'));
// Exactly what the build now ships next to the bundle.
fs.cpSync(path.join(repo, 'api', 'assets'), path.join(task, 'api', 'assets'), { recursive: true });
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

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

console.log(`function root: ${task}\n`);

const probeSource = path.join(task, 'probe-src.ts');
fs.writeFileSync(probeSource, `
import fs from 'node:fs';
import { assetFile } from '${path.join(repo, 'apps/api/src/utils/asset-file.ts').replace(/\\/g, '/')}';
const logo = assetFile('arcadelx-logo.png');
console.log('RESOLVED ' + logo);
console.log('EXISTS ' + fs.existsSync(logo));
console.log('BYTES ' + fs.readFileSync(logo).length);
console.log('FONT ' + fs.existsSync(assetFile('fonts/Lato-Regular.ttf')));
`, 'utf8');

// Emit the probe INTO the simulated function directory, exactly like the real bundle. esbuild
// is driven through its JS API because Windows cannot spawnSync a .cmd shim.
const { build: esbuild } = await import(
  pathToFileURL(path.join(repo, 'node_modules', 'esbuild', 'lib', 'main.js')).href
);
await esbuild({
  entryPoints: [probeSource],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outfile: path.join(task, 'api', 'probe.mjs'),
  logLevel: 'error',
});

// Run it from the simulated function root so cwd matches the platform.
const output = execFileSync(process.execPath, [path.join(task, 'api', 'probe.mjs')],
  { cwd: task, encoding: 'utf8' });
console.log(output.trim());

const resolved = /RESOLVED (.+)/.exec(output)?.[1]?.trim() ?? '';
check('assetFile() resolves the logo inside the function root',
  resolved.startsWith(task) && !resolved.includes('..'), resolved);
check('resolved logo exists', /EXISTS true/.test(output));
check('logo bytes read', Number(/BYTES (\d+)/.exec(output)?.[1] ?? 0) > 1000,
  /BYTES (\d+)/.exec(output)?.[1] + ' bytes');
check('bundled font resolves', /FONT true/.test(output));

// 2. The real v3.1 payload with an inline attachment must be accepted by Mailjet.
const auth = Buffer.from(
  `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`,
).toString('base64');
const logoBase64 = fs.readFileSync(path.join(task, 'api', 'assets', 'arcadelx-logo.png')).toString('base64');

const response = await fetch('https://api.mailjet.com/v3.1/send', {
  method: 'POST',
  headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    SandboxMode: true,
    Messages: [{
      From: { Email: process.env.MAIL_FROM_EMAIL, Name: process.env.MAIL_FROM_NAME },
      To: [{ Email: process.env.SEED_OWNER_EMAIL ?? 'nileegames@gmail.com' }],
      Subject: 'sandbox: credential email with inlined logo',
      TextPart: 'Validates the inline attachment path that previously threw ENOENT.',
      HTMLPart: '<p>credential email body</p><img src="cid:arcadelx-logo">',
      InlinedAttachments: [{
        ContentType: 'image/png',
        Filename: 'arcadelx-logo.png',
        Base64Content: logoBase64,
        ContentID: 'arcadelx-logo',
      }],
    }],
  }),
});
const body = await response.text();
check('Mailjet accepts the inlined-logo payload (sandbox, nothing delivered)',
  response.status === 200 && /"Status":"success"/.test(body), `${response.status}`);

console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
try { fs.rmSync(task, { recursive: true, force: true }); } catch { /* file lock */ }
process.exit(failures.length === 0 ? 0 : 1);
