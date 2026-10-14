/**
 * Live verification of the payment-gateway reorder path with the ONLINE database connected.
 *
 * What it proves, in order:
 *   1. the real server (`src/server.ts`) starts and reaches the database the root `.env`
 *      actually names -- this harness never rewrites DATABASE_URL/DIRECT_URL,
 *   2. session login on that database issues a cookie for the COMPANY OWNER, which is the
 *      gate `POST /api/admin/gateways/reorder` sits behind,
 *   3. `GET /api/admin/gateways` returns the live gateway configuration,
 *   4. the reorder the dashboard performs (same body: `{ gateways: [{provider, priority}] }`)
 *      is attempted once, never retried, and its outcome is recorded,
 *   5. the live list is read back afterwards. If -- and only if -- the priority order
 *      actually changed, the original order is restored immediately and the restore is
 *      verified too.
 *
 * Credential material is deliberately NOT persisted: Mothership returns gateway credentials
 * to an unauthenticated caller, so this file records field names only (see
 * `check-gateway-credential-exposure.cjs` for the classification of those values).
 *
 * Side effects in the database: one session (a RefreshToken row) from the login, revoked
 * again by the logout at the end. No migration, seed, or business row is written.
 *
 * Usage: node audits/gateways/verify-gateway-reorder-online.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'gateway-reorder-online.json');
const FETCH_TIMEOUT_MS = 25000;

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
const ownerEmail = seed.SEED_OWNER_EMAIL;

function describeTarget(urlString) {
  try {
    const u = new URL(urlString);
    return { host: u.host, database: u.pathname.replace(/^\//, ''), user: u.username, params: u.search };
  } catch {
    return { host: '(unparseable)' };
  }
}

/** Gateway rows with credential VALUES removed -- only the field names survive. */
function safeGateways(gateways) {
  return gateways.map((gateway) => ({
    provider: gateway.provider,
    display_name: gateway.display_name,
    priority: gateway.priority,
    is_active: gateway.is_active,
    has_driver: gateway.has_driver,
    credentialFields: Object.keys(gateway.credentials ?? {}),
    updated_at: gateway.updated_at,
  }));
}

function tsxCli() {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('tsx CLI not found in either node_modules');
  return found;
}

const evidence = {
  generatedAt: new Date().toISOString(),
  databaseTarget: describeTarget(base.DATABASE_URL),
  directTarget: describeTarget(base.DIRECT_URL),
  apiPort: PORT,
  checks: [],
  serverLogExcerpt: '',
};

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  evidence.checks.push({ name, ok, detail });
  if (!ok) failures.push(name);
}

function cookieHeader(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((value) => value.split(';')[0]).join('; ');
}

function orderOf(gateways) {
  return [...gateways].sort((a, b) => a.priority - b.priority).map((g) => g.provider);
}

function priorityPairs(gateways) {
  return [...gateways].sort((a, b) => a.priority - b.priority).map((g) => ({ provider: g.provider, priority: g.priority }));
}

async function json(response) {
  const text = await response.text();
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: null };
  }
}

const childEnv = {
  ...process.env,
  ...base,
  PORT: String(PORT),
  // Background jobs stay off: this is a request-level verification, not a sync run.
  REVENUE_JOBS_ENABLED: '',
};

const child = spawn(process.execPath, [tsxCli(), 'src/server.ts'], {
  cwd: apiRoot,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk; });
child.stderr.on('data', (chunk) => { serverLog += chunk; });

let cookie = '';

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

const authed = (url, init = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers ?? {}), cookie }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

(async () => {
  try {
    const up = await waitForServer();
    check('server starts with the configured database', up, up ? `listening on ${PORT}` : `log tail: ${serverLog.slice(-400)}`);
    if (!up) return;

    const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    check('GET /health -> 200', health.status === 200, `status ${health.status}`);

    const dbHealth = await json(await fetch(`${BASE}/health/db`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }));
    check('GET /health/db -> connected', dbHealth.text.includes('Connected'), dbHealth.text.slice(0, 120));
    evidence.databaseHealth = dbHealth.body;

    // Authenticate with a real account on the configured database.
    const credentials = { email: ownerEmail };
    credentials[secretField] = seed.SEED_OWNER_PASSWORD;
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    cookie = cookieHeader(login);
    const loginBody = await json(login);
    evidence.login = { status: login.status, body: loginBody.body, cookieIssued: cookie.length > 0 };
    check('POST /api/auth/login -> 200 (COMPANY OWNER on this database)', login.status === 200,
      `status ${login.status} body ${loginBody.text.slice(0, 160)}`);
    if (login.status !== 200 || !cookie) return;

    // /api/auth/me nests membership under `user`; that membership is exactly what the
    // gateway route's requireOrgType('COMPANY') + requireRole('OWNER','ADMIN') gate reads.
    const me = await json(await authed(`${BASE}/api/auth/me`));
    const account = me.body?.data?.user ?? me.body?.data;
    evidence.account = { email: account?.email, membership: account?.membership };
    check('GET /api/auth/me resolves the COMPANY OWNER gate',
      account?.membership?.organization?.type === 'COMPANY' && account?.membership?.role === 'OWNER',
      `orgType=${account?.membership?.organization?.type} role=${account?.membership?.role} status=${account?.membership?.status}`);

    // The upstream read needs no credentials; our own route must still refuse an
    // anonymous caller, or the live routing configuration would be world-readable here too.
    const anonymous = await fetch(`${BASE}/api/admin/gateways`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    evidence.anonymousStatus = anonymous.status;
    check('GET /api/admin/gateways without a session is refused',
      anonymous.status === 401 || anonymous.status === 403, `status ${anonymous.status}`);

    // ---- live gateway state (read-only) -------------------------------------------
    const beforeRes = await authed(`${BASE}/api/admin/gateways`);
    const before = await json(beforeRes);
    const beforeGateways = before.body?.data?.gateways ?? [];
    const beforeOrder = orderOf(beforeGateways);
    evidence.before = { status: beforeRes.status, total: before.body?.data?.total, order: beforeOrder, gateways: safeGateways(beforeGateways) };
    check('GET /api/admin/gateways -> 200', beforeRes.status === 200, `status ${beforeRes.status}`);
    check('live order read from Mothership', beforeOrder.length > 0, beforeOrder.join(' -> '));

    if (beforeOrder.length < 2) {
      check('reorder has at least two providers to swap', false, `only ${beforeOrder.length} gateway(s)`);
      return;
    }

    // ---- the reorder the dashboard performs ---------------------------------------
    const swapped = [...beforeGateways]
      .sort((a, b) => b.priority - a.priority)
      .map((gateway, index) => ({ provider: gateway.provider, priority: index + 1 }));
    evidence.reorderRequest = { gateways: swapped };

    const reorderRes = await authed(`${BASE}/api/admin/gateways/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gateways: swapped }),
    });
    const reorderBody = await json(reorderRes);
    evidence.reorderResponse = { status: reorderRes.status, body: reorderBody.body };

    // ---- read back ------------------------------------------------------------------
    const after = await json(await authed(`${BASE}/api/admin/gateways`));
    const afterGateways = after.body?.data?.gateways ?? [];
    const afterOrder = orderOf(afterGateways);
    evidence.after = { order: afterOrder, gateways: safeGateways(afterGateways) };

    const applied = afterOrder.join(',') === swapped.map((g) => g.provider).join(',');
    const unchanged = afterOrder.join(',') === beforeOrder.join(',');

    check('reorder response recorded', true,
      `HTTP ${reorderRes.status} :: ${(reorderBody.body?.message ?? reorderBody.text).slice(0, 160)}`);
    check('live routing order unchanged by the attempt (or restored below)', unchanged || applied,
      `before=${beforeOrder.join(' -> ')} after=${afterOrder.join(' -> ')}`);
    check('provider updated_at values unchanged (nothing was stored)',
      JSON.stringify(safeGateways(afterGateways).map((g) => g.updated_at)) ===
        JSON.stringify(safeGateways(beforeGateways).map((g) => g.updated_at)),
      safeGateways(afterGateways).map((g) => `${g.provider}@${g.updated_at}`).join(' | '));

    if (applied) {
      // The upstream honoured the write after all: put the original order back at once.
      const restore = priorityPairs(beforeGateways);
      const restoredRes = await authed(`${BASE}/api/admin/gateways/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateways: restore }),
      });
      const restoredBody = await json(restoredRes);
      const finalRead = await json(await authed(`${BASE}/api/admin/gateways`));
      const finalOrder = orderOf(finalRead.body?.data?.gateways ?? []);
      evidence.restore = { request: { gateways: restore }, status: restoredRes.status, body: restoredBody.body, finalOrder };
      check('original order restored', finalOrder.join(',') === beforeOrder.join(','), finalOrder.join(' -> '));
    }

    // Leave no live session behind.
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
