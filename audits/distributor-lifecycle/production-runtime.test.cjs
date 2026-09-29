// No database writes or external email. Pass an isolated checkout as argv[2].
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

const root = path.resolve(process.argv[2] || process.cwd());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadelx-production-smoke-'));
const url = relative => pathToFileURL(path.join(root, relative)).href;
const envUrl = url('apps/api/src/config/env.ts');
const testEnv = {
  ...process.env,
  NODE_ENV: 'production', PORT: '45679',
  TSX_TSCONFIG_PATH: path.join(root, 'apps/api/tsconfig.json'),
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/not_connected',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/not_connected',
  ACCESS_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'),
  REFRESH_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'),
  INTERNAL_API_SECRET: crypto.randomBytes(32).toString('hex'),
  ACCESS_EXPIRY: '15m', REFRESH_EXPIRY: '7d',
  MAILJET_API_KEY: 'local-test-only', MAILJET_SECRET_KEY: 'local-test-only',
  MAIL_FROM_EMAIL: 'test@example.invalid', MAIL_FROM_NAME: 'Local test',
  FRONTEND_LOGIN_URL: 'https://example.invalid/login',
  INVOICES_DIR: path.join(scratch, 'persistent-invoices'),
};
function run(code, overrides = {}) {
  return spawnSync(process.execPath, ['--import', url('node_modules/tsx/dist/loader.mjs'), '--input-type=module', '-e', code], {
    cwd: scratch, env: { ...testEnv, ...overrides }, encoding: 'utf8', timeout: 45000,
  });
}
test('complete production settings validate', () => {
  const result = run(`await import(${JSON.stringify(envUrl)});`);
  assert.equal(result.status, 0, result.stderr);
});
for (const [name, overrides] of [
  ['missing email provider key', { MAILJET_API_KEY: '' }],
  ['HTTP login URL', { FRONTEND_LOGIN_URL: 'http://example.invalid/login' }],
  ['relative invoice storage', { INVOICES_DIR: 'invoices' }],
  ['invalid expiry', { ACCESS_EXPIRY: 'never' }],
  ['invalid port', { PORT: '70000' }],
]) {
  test(`production rejects ${name}`, () => {
    const result = run(`await import(${JSON.stringify(envUrl)});`, overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid environment variables/);
  });
}
test('production cookie creation and clearing use matching secure paths', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    const {setTokenCookies, clearTokenCookies} = await import(${JSON.stringify(url('apps/api/src/utils/token.ts'))});
    const set = [], clear = [];
    const res = { cookie: (name, value, opts) => set.push({name, opts}), clearCookie: (name, opts) => clear.push({name, opts}) };
    setTokenCookies(res, 'dummy-access', 'dummy-refresh'); clearTokenCookies(res);
    for (const cookie of [...set,...clear]) { assert.equal(cookie.opts.secure, true); assert.equal(cookie.opts.httpOnly, true); assert.equal(cookie.opts.sameSite, 'strict'); }
    for (let i = 0; i < set.length; i++) { assert.equal(set[i].name, clear[i].name); assert.equal(set[i].opts.path || '/', clear[i].opts.path); }
  `);
  assert.equal(result.status, 0, result.stderr);
});
for (const [name, value] of [['missing backend origin', ''], ['backend URL containing a path', 'https://example.invalid/api']]) {
  test(`production frontend rejects ${name}`, () => {
    const result = run(`await import(${JSON.stringify(url('apps/web/next-monorepo/apps/web/next.config.ts'))});`, { BACKEND_API_URL: value });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BACKEND_API_URL/);
  });
}
test('production frontend uses the explicit backend origin', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    const {default: config} = await import(${JSON.stringify(url('apps/web/next-monorepo/apps/web/next.config.ts'))});
    assert.equal((await config.rewrites())[0].destination, 'https://api.example.invalid/api/:path*');
  `, { BACKEND_API_URL: 'https://api.example.invalid/' });
  assert.equal(result.status, 0, result.stderr);
});
test('invoice generation writes to the configured storage directory', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    const {INVOICES_DIR, generateInvoicePDF} = await import(${JSON.stringify(url('apps/api/src/services/pdf/invoice.pdf.ts'))});
    assert.equal(INVOICES_DIR, process.env.INVOICES_DIR);
    const filename = await generateInvoicePDF({orderNumber:'TEST-PRODUCTION',parentOrgName:'Test Company',childOrgName:'Test Distributor',quantity:1,depositPerMachine:100,nonRefundablePerMachine:50,totalDeposit:100,totalNonRefundable:50,taxAmount:9,grandTotal:159,date:new Date('2026-01-01')});
    assert.equal(fs.readFileSync(path.join(INVOICES_DIR,filename)).subarray(0,4).toString(),'%PDF');
  `);
  assert.equal(result.status, 0, result.stderr);
});
test('production API boots and anonymous logout clears both cookies without a DB connection', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    const { default: app } = await import(${JSON.stringify(url('apps/api/src/app.ts'))});
    const { prisma } = await import(${JSON.stringify(url('apps/api/src/utils/db.ts'))});
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      assert.equal((await fetch(base + '/health')).status, 200);
      const response = await fetch(base + '/api/auth/refresh/logout', { method: 'POST' });
      assert.equal(response.status, 200);
      const cookies = response.headers.getSetCookie();
      assert.equal(cookies.length, 2);
      assert.ok(cookies.some(c => c.startsWith('refresh_token=;') && c.includes('Path=/api/auth/refresh;')));
      for (const c of cookies) { assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Strict/); }
    } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
  `);
  assert.equal(result.status, 0, result.stderr);
});

// Optional integration check: build the frontend with BACKEND_API_URL=http://127.0.0.1:45678 first.
if (process.argv.includes('--with-frontend')) test('built Next frontend proxies logout to the production API', () => {
  const web = path.join(root, 'apps/web/next-monorepo/apps/web');
  const manifest = JSON.parse(fs.readFileSync(path.join(web, '.next/routes-manifest.json'), 'utf8'));
  assert.ok(manifest.rewrites.afterFiles.some(rule => rule.destination === 'http://127.0.0.1:45678/api/:path*'));
  const result = run(`
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import net from 'node:net';
    const {default: app} = await import(${JSON.stringify(url('apps/api/src/app.ts'))});
    const {prisma} = await import(${JSON.stringify(url('apps/api/src/utils/db.ts'))});
    const api = app.listen(45678, '127.0.0.1');
    await new Promise((resolve,reject) => { api.once('listening',resolve); api.once('error',reject); });
    const probe = net.createServer(); probe.listen(0,'127.0.0.1'); await new Promise(resolve=>probe.once('listening',resolve));
    const port = probe.address().port; await new Promise(resolve=>probe.close(resolve));
    const frontend = spawn(process.execPath, [${JSON.stringify(path.join(root, 'apps/web/next-monorepo/node_modules/next/dist/bin/next'))}, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: ${JSON.stringify(web)}, env: {...process.env, BACKEND_API_URL:'http://127.0.0.1:45678'}, windowsHide:true, stdio:'ignore'
    });
    try {
      const base = 'http://127.0.0.1:'+port;
      let ready=false;
      for(let i=0;i<100;i++) { try { if((await fetch(base+'/login')).status===200) { ready=true;break; } } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
      assert.ok(ready,'Built frontend did not start');
      const response=await fetch(base+'/api/auth/refresh/logout',{method:'POST'});
      assert.equal(response.status,200);
      assert.equal((await response.json()).message,'Signed out successfully');
      assert.equal(response.headers.getSetCookie().length,2);
      assert.ok(response.headers.getSetCookie().every(cookie=>cookie.includes('Secure') && cookie.includes('HttpOnly')));
    } finally { frontend.kill(); await new Promise(resolve=>api.close(resolve)); await prisma.$disconnect(); }
  `);
  assert.equal(result.status,0,result.stderr);
});
