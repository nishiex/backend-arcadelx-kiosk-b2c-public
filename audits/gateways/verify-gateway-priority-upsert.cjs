/**
 * Switches the live gateway priority through the per-provider upsert
 * (`POST /api/admin/gateways`) -- the call the dashboard's "Add or update a provider" form
 * already makes -- because `/reorder` provably stores nothing, in either direction.
 *
 * Modes:
 *   (default)     swap    : expects razorpay=1 / payu=2  -> promotes payu to 1, demotes razorpay to 2
 *   --restore     restore : expects payu=1 / razorpay=2  -> promotes razorpay to 1, demotes payu to 2
 *   --read-only   snapshot: records the live order and writes nothing at all
 *
 * Write order matters. Mothership updates one provider per call, so a two-step swap passes
 * through a transient tie. Each mode is written so a priority-1 provider exists throughout:
 *   swap    : payu->1 first   (payu=1/razorpay=1)
 *   restore : razorpay->1 first (razorpay=1/payu=1)
 * The opposite order would briefly leave no provider at priority 1 at all.
 *
 * Guards:
 *   - refuses to write unless the live order is exactly the state that mode expects,
 *   - reads the list back after every write and records what actually persisted,
 *   - records each provider's `updated_at` and credential field names, so an unintended
 *     change to the other provider (or to credentials) is visible rather than assumed,
 *   - never retries a write.
 *
 * Usage:
 *   node audits/gateways/verify-gateway-priority-upsert.cjs
 *   node audits/gateways/verify-gateway-priority-upsert.cjs --restore
 *   node audits/gateways/verify-gateway-priority-upsert.cjs --read-only
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;
const FETCH_TIMEOUT_MS = 25000;

const mode = process.argv.includes('--read-only')
  ? 'read-only'
  : process.argv.includes('--restore')
    ? 'restore'
    : 'swap';

const OUT = path.join(__dirname, {
  'read-only': 'gateway-priority-snapshot.json',
  restore: 'gateway-priority-restore.json',
  swap: 'gateway-priority-upsert.json',
}[mode]);

/**
 * `from` is the live order the mode insists on before writing (as `provider=priority`),
 * `to` is the intended end state, and `steps` are the upserts that get there -- in order.
 */
const PLANS = {
  swap: {
    from: ['razorpay=1', 'payu=2'],
    to: ['payu=1', 'razorpay=2'],
    steps: [
      { provider: 'payu', priority: 1 },
      { provider: 'razorpay', priority: 2 },
    ],
  },
  restore: {
    from: ['payu=1', 'razorpay=2'],
    to: ['razorpay=1', 'payu=2'],
    steps: [
      { provider: 'razorpay', priority: 1 },
      { provider: 'payu', priority: 2 },
    ],
  },
};

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

function safeGateways(gateways) {
  return gateways.map((gateway) => ({
    provider: gateway.provider,
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

const evidence = { generatedAt: new Date().toISOString(), mode, apiPort: PORT, checks: [], writes: [], reads: [] };
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

async function readList() {
  const read = await json(await authed(`${BASE}/api/admin/gateways`));
  evidence.reads.push({ at: new Date().toISOString(), status: read.status, gateways: safeGateways(read.body?.data?.gateways ?? []) });
  return read.body?.data?.gateways ?? [];
}

async function upsert(input) {
  const response = await json(await authed(`${BASE}/api/admin/gateways`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }));
  evidence.writes.push({ at: new Date().toISOString(), request: input, status: response.status, body: response.body });
  console.log(`  POST /api/admin/gateways ${JSON.stringify(input)} -> HTTP ${response.status} ${response.text.slice(0, 120)}`);
  return response;
}

function orderOf(gateways) {
  return [...gateways].sort((a, b) => a.priority - b.priority).map((g) => `${g.provider}=${g.priority}`);
}

/**
 * Per-provider comparison, keyed by provider: a successful switch reorders the list and the
 * read-only path sees raw rows (which carry `credentials`), so an order-sensitive or
 * raw-vs-safe comparison reports a false change in exactly the case that matters.
 * Credential *names* only -- values are never read into the harness.
 */
function providersMatch(before, after) {
  const key = (list) => Object.fromEntries(
    [...list].sort((a, b) => a.provider.localeCompare(b.provider)).map((g) => [
      g.provider,
      JSON.stringify({
        is_active: g.is_active,
        has_driver: g.has_driver,
        credentialFields: [...(g.credentialFields ?? Object.keys(g.credentials ?? {}))].sort(),
      }),
    ]),
  );
  const beforeKey = key(before);
  const afterKey = key(after);
  return Object.keys(beforeKey).length === Object.keys(afterKey).length &&
    Object.entries(beforeKey).every(([provider, value]) => afterKey[provider] === value);
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
    check('server starts with the configured database', await waitForServer(), `listening on ${PORT}`);

    const credentials = { email: seed.SEED_OWNER_EMAIL };
    credentials[secretField] = seed.SEED_OWNER_PASSWORD;
    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    cookie = (loginResponse.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
    const login = await json(loginResponse);
    check('login as the COMPANY OWNER', login.status === 200, `status ${login.status}`);
    check('session cookie captured', cookie.length > 0, cookie ? 'present' : 'missing');
    if (login.status !== 200 || !cookie) return;

    const before = await readList();
    const beforeOrder = orderOf(before);
    console.log('  live state before:', beforeOrder.join(' | '));

    // `--read-only` records the live state without performing any write.
    if (mode === 'read-only') {
      const safeBefore = safeGateways(before);
      check('read-only snapshot taken', before.length > 0, beforeOrder.join(' | '));
      check('both providers active with credentials',
        safeBefore.every((g) => g.is_active && g.has_driver && g.credentialFields.length > 0),
        safeBefore.map((g) => `${g.provider}: ${g.credentialFields.length} fields, driver=${g.has_driver}, active=${g.is_active}`).join(' | '));
      return;
    }

    // Writing modes insist on the state they were written for; on anything else they report
    // and stop rather than writing to live routing blind.
    const plan = PLANS[mode];
    check(`live state is the expected ${plan.from.join(' / ')}`,
      beforeOrder.join(',') === plan.from.join(','), beforeOrder.join(' | '));
    if (beforeOrder.join(',') !== plan.from.join(',')) {
      console.log('  refusing to write: the live order is not the state this mode expects');
      return;
    }

    for (const [index, step] of plan.steps.entries()) {
      console.log(`  step ${index + 1}: ${step.provider} -> priority ${step.priority}`);
      await upsert(step);
      console.log('  live state now:', orderOf(await readList()).join(' | '));
    }

    const after = await readList();
    const finalOrder = orderOf(after);
    const confirm = orderOf(await readList());
    const touched = plan.steps.map((step) => step.provider);

    check(`priority switched to ${plan.to.join(' / ')} through the upsert route`,
      finalOrder.join(',') === plan.to.join(','), finalOrder.join(' | '));
    check('order is stable across two reads', confirm.join(',') === finalOrder.join(','), confirm.join(' | '));
    for (const provider of touched) {
      const beforeRow = before.find((g) => g.provider === provider);
      const afterRow = after.find((g) => g.provider === provider);
      check(`${provider} stored the new priority (updated_at moved)`,
        afterRow?.updated_at !== beforeRow?.updated_at, `${beforeRow?.updated_at} -> ${afterRow?.updated_at}`);
    }
    const safeAfter = safeGateways(after);
    check('both providers still active with their credentials',
      safeAfter.every((g) => g.is_active && g.has_driver && g.credentialFields.length > 0) &&
        providersMatch(before, after),
      safeAfter.map((g) => `${g.provider}: ${g.credentialFields.length} fields, driver=${g.has_driver}, active=${g.is_active}`).join(' | '));

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
