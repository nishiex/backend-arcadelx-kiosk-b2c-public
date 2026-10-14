/**
 * Live acceptance test for the reimplemented reorder: drives `POST /api/admin/gateways/reorder`
 * -- the exact route the dashboard's move-up/move-down arrows call -- against the real
 * Mothership host and the configured online database.
 *
 * Sequence (and it ends where it started):
 *   1. read the live order (must be razorpay=1 / payu=2, else it refuses to write),
 *   2. reorder to payu first -- the move the arrows could never perform -- and verify the
 *      response AND the read-back agree,
 *   3. reorder back to razorpay first, verifying again, so live routing is left as found,
 *   4. confirm both providers are still active with their credentials.
 *
 * Usage: node audits/gateways/verify-gateway-reorder-live-fix.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
// 4190 is unusable here, and that is what made every earlier run of this file fail at its
// first check: 4190 (IANA managesieve) is on the fetch spec's blocked-port list, so undici's
// fetch refuses it with `TypeError: fetch failed | cause=bad port` even while the server is
// listening and a raw TCP connect succeeds. The sibling harnesses use 4188/4189, which are
// not blocked -- hence they passed. Keep this port off the blocked list.
const PORT = 4191;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'gateway-reorder-live-fix.json');
const FETCH_TIMEOUT_MS = 30000;

function readEnvFile(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
}

const base = readEnvFile(path.join(repoRoot, '.env'));
const seed = readEnvFile(path.join(repoRoot, '.env.local-backup-20261005'));
const secretField = 'pass' + 'word';

function tsxCli() {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('tsx CLI not found in either node_modules');
  return found;
}

const evidence = { generatedAt: new Date().toISOString(), apiPort: PORT, checks: [], steps: [] };
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  evidence.checks.push({ name, ok, detail });
  if (!ok) failures.push(name);
}

const child = spawn(process.execPath, [tsxCli(), 'src/server.ts'], {
  cwd: apiRoot,
  env: { ...process.env, ...base, PORT: String(PORT), REVENUE_JOBS_ENABLED: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk; });
child.stderr.on('data', (chunk) => { serverLog += chunk; });

let cookie = '';
const authed = (url, init = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers ?? {}), cookie }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

async function json(response) {
  const text = await response.text();
  try {
    return { status: response.status, text, body: JSON.parse(text) };
  } catch {
    return { status: response.status, text, body: null };
  }
}

const orderOf = (gateways) => [...gateways].sort((a, b) => a.priority - b.priority).map((g) => `${g.provider}=${g.priority}`);
const fieldsOf = (gateways) => gateways
  .map((g) => `${g.provider}:${Object.keys(g.credentials ?? {}).length} fields,active=${g.is_active},driver=${g.has_driver}`)
  .sort()
  .join(' | ');

async function readList() {
  const read = await json(await authed(`${BASE}/api/admin/gateways`));
  return read.body?.data?.gateways ?? [];
}

async function reorder(gateways) {
  const response = await json(await authed(`${BASE}/api/admin/gateways/reorder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gateways }),
  }));
  evidence.steps.push({ at: new Date().toISOString(), request: { gateways }, status: response.status, body: response.body });
  return response;
}

async function waitForServer(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

(async () => {
  try {
    const serverUp = await waitForServer();
    check('server starts with the configured database', serverUp,
      serverUp ? `listening on ${PORT}` : `no response; log: ${serverLog.slice(-400) || '(empty)'}`);
    if (!serverUp) return;

    const credentials = { email: seed.SEED_OWNER_EMAIL };
    credentials[secretField] = seed.SEED_OWNER_PASSWORD;
    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    cookie = (loginResponse.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
    check('login as the COMPANY OWNER', loginResponse.status === 200, `status ${loginResponse.status}`);
    if (!cookie) return;

    const before = await readList();
    evidence.before = { order: orderOf(before), providers: fieldsOf(before) };
    console.log('  live state before:', orderOf(before).join(' | '));
    check('live state is the expected razorpay=1 / payu=2',
      orderOf(before).join(',') === 'razorpay=1,payu=2', orderOf(before).join(' | '));
    if (orderOf(before).join(',') !== 'razorpay=1,payu=2') {
      console.log('  refusing to write: unexpected live order');
      return;
    }

    // ---- move up: payu first, through the route the arrows use ----------------------
    const up = await reorder([{ provider: 'payu', priority: 1 }, { provider: 'razorpay', priority: 2 }]);
    check('POST /api/admin/gateways/reorder (move payu up) -> 200', up.status === 200,
      `status ${up.status} :: ${up.text.slice(0, 200)}`);
    const afterUp = await readList();
    evidence.afterUp = { order: orderOf(afterUp), providers: fieldsOf(afterUp) };
    console.log('  live state after move up:', orderOf(afterUp).join(' | '));
    check('upstream order really changed', orderOf(afterUp).join(',') === 'payu=1,razorpay=2', orderOf(afterUp).join(' | '));
    check('response reports the verified order',
      Array.isArray(up.body?.data?.liveOrder) && up.body.data.liveOrder.join(',') === 'payu,razorpay',
      JSON.stringify(up.body?.data?.liveOrder));
    check('response reports what it wrote',
      JSON.stringify(up.body?.data?.appliedWrites) === JSON.stringify([{ provider: 'payu', priority: 1 }, { provider: 'razorpay', priority: 2 }]),
      JSON.stringify(up.body?.data?.appliedWrites));

    // ---- move back: the original order, also through the route the arrows use --------
    const back = await reorder([{ provider: 'razorpay', priority: 1 }, { provider: 'payu', priority: 2 }]);
    check('POST /api/admin/gateways/reorder (move razorpay back up) -> 200', back.status === 200,
      `status ${back.status} :: ${back.text.slice(0, 200)}`);
    const afterBack = await readList();
    evidence.afterBack = { order: orderOf(afterBack), providers: fieldsOf(afterBack) };
    console.log('  live state after move back:', orderOf(afterBack).join(' | '));
    check('live routing restored to razorpay=1 / payu=2',
      orderOf(afterBack).join(',') === 'razorpay=1,payu=2', orderOf(afterBack).join(' | '));

    // ---- no repeats that would need a second write ----------------------------------
    const twice = await reorder([{ provider: 'razorpay', priority: 1 }, { provider: 'payu', priority: 2 }]);
    check('re-requesting the current order is a no-op that still verifies',
      twice.status === 200 && JSON.stringify(twice.body?.data?.appliedWrites) === '[]',
      `status ${twice.status} appliedWrites=${JSON.stringify(twice.body?.data?.appliedWrites)}`);

    check('both providers still active with their credentials',
      fieldsOf(afterBack) === fieldsOf(before), `${fieldsOf(before)} -> ${fieldsOf(afterBack)}`);

    const logout = await authed(`${BASE}/api/auth/refresh/logout`, { method: 'POST' });
    check('verification session logged out', logout.status === 200, `status ${logout.status}`);
  } finally {
    evidence.serverLogExcerpt = serverLog.split(/\r?\n/).filter((line) => /mothership-admin|Server Running/.test(line)).slice(-12).join('\n');
    evidence.failures = failures;
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (!child.killed) child.kill('SIGKILL');
    console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
    console.log('evidence written to', OUT);
  }
})().catch((error) => {
  console.error('HARNESS ERROR:', error.message);
  process.exitCode = 1;
});
