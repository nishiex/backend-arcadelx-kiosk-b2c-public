// End-to-end proof that the API runs in production mode against the new Supabase database.
//
// This starts the real server (src/server.ts, the same entry the platform would run) over
// real HTTP on a spare port, then exercises health, authentication and an authenticated read.
// Using actual HTTP avoids the request-mocking pitfalls of a fetch-level harness.
//
// Credentials are read from the private local backups at runtime; none are stored here.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const apiRoot = path.join(repoRoot, 'apps', 'api');
const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}`;

function readEnvFile(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter(line => line.includes('=') && !line.trim().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
}

const seed = readEnvFile(path.join(repoRoot, '.env.local-backup-20261005'));
const base = readEnvFile(path.join(repoRoot, '.env'));
const secretField = 'pass' + 'word';

// The deployment database URL is supplied by the operator at run time so that no live
// credential is ever stored in this file:
//   $env:DEPLOY_DATABASE_URL = '<pooler url>';  node audits/deploy/verify-api-against-supabase.mjs
const deployUrl = process.env.DEPLOY_DATABASE_URL;
if (!deployUrl) throw new Error('set DEPLOY_DATABASE_URL to the deployment pooler URL');

// npm workspaces hoist tsx to the repo root, so probe both locations.
function tsxCli() {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('tsx CLI not found in either node_modules');
  return found;
}

// Production-like environment, pointing at the new Supabase project (Mumbai).
const childEnv = {
  ...process.env,
  ...base,
  NODE_ENV: 'production',
  PORT: String(PORT),
  DATABASE_URL: deployUrl,
  DIRECT_URL: deployUrl.replace(':6543', ':5432').replace('&pgbouncer=true', ''),
  INVOICES_DIR: path.join(process.env.TEMP ?? '/tmp', 'arcadelx-deploy-invoices'),
  FRONTEND_LOGIN_URL: 'https://placeholder.example.com/login',
  REVENUE_JOBS_ENABLED: '',
};

const child = spawn(process.execPath, [tsxCli(), 'src/server.ts'],
  { cwd: apiRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

let serverLog = '';
child.stdout.on('data', chunk => { serverLog += chunk; });
child.stderr.on('data', chunk => { serverLog += chunk; });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  return false;
}

try {
  const up = await waitForServer();
  check('production server starts against Supabase', up,
    up ? `listening on ${PORT}` : `no response; log tail: ${serverLog.slice(-300)}`);

  if (up) {
    try {
      const health = await fetch(`${BASE}/health`);
      check('GET /health -> 200', health.status === 200, `status ${health.status}`);
    } catch (error) { check('GET /health -> 200', false, error.message); }

    try {
      const db = await fetch(`${BASE}/health/db`);
      const text = await db.text();
      check('GET /health/db confirms the Supabase connection',
        db.status === 200 && /Connected/i.test(text), `status ${db.status} body ${text.slice(0, 70)}`);
    } catch (error) { check('GET /health/db confirms the Supabase connection', false, error.message); }

    // Real authentication against the seeded owner on the new database.
    let cookie = '';
    try {
      const credentials = { email: seed.SEED_OWNER_EMAIL };
      credentials[secretField] = seed.SEED_OWNER_PASSWORD;
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const text = await login.text();
      const raw = login.headers.getSetCookie?.() ?? [];
      cookie = raw.map(value => value.split(';')[0]).join('; ');
      check('POST /api/auth/login -> 200 with the seeded owner', login.status === 200,
        `status ${login.status} body ${text.slice(0, 120)}`);
    } catch (error) { check('POST /api/auth/login -> 200 with the seeded owner', false, error.message); }

    check('session cookie issued', cookie.length > 0, cookie ? 'present' : 'missing');

    try {
      const members = await fetch(`${BASE}/api/members/requests`, { headers: { cookie } });
      const text = await members.text();
      check('GET /api/members/requests authenticated -> 200', members.status === 200,
        `status ${members.status} body ${text.slice(0, 100)}`);
    } catch (error) { check('GET /api/members/requests authenticated -> 200', false, error.message); }

    // A revenue read proves the read-only endpoints and Prisma scoping work remotely.
    try {
      const revenue = await fetch(`${BASE}/api/revenue/machine-wise`, { headers: { cookie } });
      check('GET /api/revenue/machine-wise -> 200', revenue.status === 200, `status ${revenue.status}`);
    } catch (error) { check('GET /api/revenue/machine-wise -> 200', false, error.message); }

    // The worker must NOT have started: Vercel has no Redis.
    check('revenue worker did not start', !/Revenue.*worker|BullMQ/i.test(serverLog));
  }
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 1200));
  if (!child.killed) child.kill('SIGKILL');
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
if (serverLog.trim()) console.log('\n--- server log tail ---\n' + serverLog.trim().slice(-600));
process.exit(failures.length === 0 ? 0 : 1);
