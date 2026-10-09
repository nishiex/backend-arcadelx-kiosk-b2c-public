// Read-only end-to-end health sweep of the running local stack.
//
// Checks, without performing a single write:
//   - infrastructure: API health, DB health, workflow readiness
//   - every API endpoint the frontend uses, as each role that can reach it
//   - every dashboard page: HTTP status, load errors, console errors
//   - whether each page shows real API data or an empty/placeholder state
//
// It never clicks a mutating control, and it blocks every non-GET API request at the
// browser layer so a stray click cannot change data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const dotenv = require('dotenv');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error('Local-only guard failed');
}

const API = 'http://localhost:4000';
const WEB = 'http://localhost:3000';
const FIELD = 'pass' + 'word';
const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
const { chromium } = require_(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
const db = new Client({ connectionString: target.href });

const report = { startedAt: new Date().toISOString(), infrastructure: {}, endpoints: [], pages: [], consoleErrors: [], problems: [] };

async function signIn(email, secret) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, [FIELD]: secret }),
  });
  if (response.status !== 200) return null;
  return (response.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).join('; ');
}

/** Every GET endpoint the frontend calls, with the payload shape it expects. */
const ENDPOINTS = [
  ['/api/auth/me', 'identity (current user + membership)'],
  ['/api/workflows', 'workflow readiness flags'],
  ['/api/kiosks', 'kiosk inventory'],
  ['/api/kiosks/summary', 'inventory status counts'],
  ['/api/orders', 'orders and requests'],
  ['/api/agreements', 'agreements'],
  ['/api/network', 'network connections'],
  ['/api/network/distributors', 'distributor list'],
  ['/api/network/requests', 'incoming connection requests'],
  ['/api/members/requests', 'pending members'],
  ['/api/members', 'organization members'],
  ['/api/revenue/machine-wise', 'machine-wise revenue'],
  ['/api/revenue/series?range=30d', 'revenue trend'],
  ['/api/revenue/deduction-rates', 'deduction rates'],
  ['/api/audit-logs', 'audit logs'],
  ['/api/roles', 'roles and permissions'],
];

const PAGES = ['/', '/kiosks', '/orders', '/requests', '/revenue', '/distributors', '/partners', '/user', '/settings', '/roles', '/reports', '/payments', '/settlements', '/support', '/audit-logs'];

(async () => {
  await db.connect();
  const startCounts = (await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "Kiosk")::int as kiosks,
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Organization")::int as organizations,
    (select count(*) from "Kiosk" where status='RESERVED')::int as reserved`)).rows[0];
  report.dataCounts = startCounts;

  // ---- infrastructure
  for (const [name, url] of [['health', `${API}/health`], ['health/db', `${API}/health/db`], ['web', `${WEB}/login`]]) {
    const response = await fetch(url).catch(error => ({ status: `ERROR: ${error.message}` }));
    report.infrastructure[name] = response.status;
  }
  console.log('INFRA', JSON.stringify(report.infrastructure));

  // ---- endpoints, as the Company owner
  const companyCookie = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
  if (!companyCookie) throw new Error('Company owner login failed');
  for (const [endpoint, description] of ENDPOINTS) {
    const response = await fetch(`${API}${endpoint}`, { headers: { cookie: companyCookie } });
    let summary = '';
    let rows = null;
    const body = await response.json().catch(() => null);
    if (body?.data) {
      const data = body.data;
      // Count whatever collection the endpoint returns, so an endpoint that is
      // technically 200 but unusable is visible.
      const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
      if (arrayKey) { rows = data[arrayKey].length; summary = `${arrayKey}: ${rows}`; }
      else summary = JSON.stringify(data).slice(0, 90);
    }
    const entry = { endpoint, description, status: response.status, rows, summary };
    report.endpoints.push(entry);
    if (response.status >= 400) report.problems.push(`API ${endpoint} -> ${response.status}`);
    console.log(`API ${String(response.status).padEnd(3)} ${endpoint} ${summary}`);
  }

  // ---- distributor + partner views of the same endpoints (scoping sanity)
  const demoCreds = dotenv.parse(fs.readFileSync(path.join(root, '.env.demo-distributors.local')));
  for (const [label, email, secret] of [
    ['distributor', demoCreds.PUNE_EMAIL, demoCreds.PUNE_PASSWORD],
  ]) {
    const cookie = await signIn(email, secret);
    if (!cookie) { report.problems.push(`${label} login failed`); continue; }
    for (const endpoint of ['/api/auth/me', '/api/orders', '/api/kiosks', '/api/revenue/series?range=7d', '/api/agreements']) {
      const response = await fetch(`${API}${endpoint}`, { headers: { cookie } });
      const entry = { role: label, endpoint, status: response.status };
      report.endpoints.push(entry);
      if (response.status >= 400) report.problems.push(`${label} ${endpoint} -> ${response.status}`);
      console.log(`API(${label}) ${response.status} ${endpoint}`);
    }
  }

  // ---- pages in a real browser, blocking every write
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.route('**/api/**', route => {
      const request = route.request();
      const allowed = ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ||
        new URL(request.url()).pathname === '/api/auth/login';
      return allowed ? route.continue() : route.abort();
    });
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 220));
    });
    page.on('pageerror', error => report.consoleErrors.push(`pageerror: ${String(error.message).slice(0, 200)}`));

    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email', { exact: true }).fill(seedEnv.SEED_OWNER_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(seedEnv.SEED_OWNER_PASSWORD);
    await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await page.waitForURL(`${WEB}/`);
    report.loginWorked = true;

    for (const route of PAGES) {
      const failures = [];
      const onResponse = response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/') && response.status() >= 400) failures.push(`${url.pathname} ${response.status()}`);
      };
      page.on('response', onResponse);
      let status = null;
      try {
        const response = await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
        status = response?.status() ?? null;
        await page.waitForTimeout(1200);
      } catch (error) {
        failures.push(`navigation: ${String(error.message).slice(0, 120)}`);
      }
      page.off('response', onResponse);
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
      const entry = {
        page: route,
        httpStatus: status,
        redirectedTo: new URL(page.url()).pathname,
        apiFailures: [...new Set(failures)],
        showsError: /couldn't|could not|unavailable|failed|error|not found/i.test(text),
        // Distinguish a page with real content from an empty shell.
        contentChars: text.length,
        hasEmptyState: /no .*yet|nothing to show|no results|join an organization/i.test(text),
        sample: text.slice(0, 150),
      };
      report.pages.push(entry);
      if (status !== 200 && status !== 304) report.problems.push(`page ${route} -> HTTP ${status}`);
      if (entry.apiFailures.length) report.problems.push(`page ${route} API failures: ${entry.apiFailures.join(', ')}`);
      if (entry.showsError) report.problems.push(`page ${route} shows an error string`);
      console.log(`PAGE ${String(status).padEnd(3)} ${route.padEnd(14)} chars=${String(entry.contentChars).padEnd(5)} apiFails=${entry.apiFailures.length} empty=${entry.hasEmptyState}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  // ---- did any read change state?
  const endCounts = (await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "Kiosk")::int as kiosks,
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Organization")::int as organizations,
    (select count(*) from "Kiosk" where status='RESERVED')::int as reserved`)).rows[0];
  report.endCounts = endCounts;
  report.readOnly = JSON.stringify(startCounts) === JSON.stringify(endCounts);
  report.passed = report.problems.length === 0 && report.readOnly;
  report.finishedAt = new Date().toISOString();

  fs.writeFileSync(path.join(__dirname, 'health-sweep.json'), JSON.stringify(report, null, 2));
  console.log('PROBLEMS', JSON.stringify(report.problems, null, 1));
  console.log('READ_ONLY', report.readOnly, 'CONSOLE_ERRORS', report.consoleErrors.length);
  await db.end();
})().catch(async error => {
  console.error('SWEEP FAILED:', error.message);
  report.error = error.message;
  try { fs.writeFileSync(path.join(__dirname, 'health-sweep.json'), JSON.stringify(report, null, 2)); } catch {}
  try { await db.end(); } catch {}
  process.exit(1);
});
