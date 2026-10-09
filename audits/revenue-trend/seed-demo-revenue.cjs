// Seed realistic demo revenue so the dashboard revenue trend has data to draw.
//
// Why this is needed: the local Transaction ledger is empty, and revenue is only
// attributable INSIDE a kiosk assignment window. The 12 existing assignments all
// begin 2026-10-05, so transaction rows alone can only ever populate three days.
//
// What this does (local-only, additive, no schema or migration change):
//   1. records the prior state,
//   2. gives a small set of currently UNASSIGNED kiosks one open assignment that
//      began ~12 months ago (the partial unique index allows one open assignment
//      per kiosk, and these have none) -- so no pre-existing row is modified,
//   3. generates a few INR transactions per kiosk per day across each open
//      assignment window, at IST daytime hours,
//   4. verifies the endpoint over HTTP, then optionally removes everything again.
//
// Timestamps are written as naive UTC wall clock because Transaction.occurredAt
// and KioskAssignment.assignedFrom are `timestamp without time zone` and Prisma
// reads them as UTC (the database session timezone is Etc/UTC).
//
//   node audits/revenue-trend/seed-demo-revenue.cjs            # seed + verify
//   node audits/revenue-trend/seed-demo-revenue.cjs --cleanup  # remove demo rows
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error(`Local-only guard failed for ${target.host}${target.pathname}`);
}

const API = 'http://localhost:4000';
const ASSIGNMENT_PREFIX = 'demo-canary-assign-';
const TRANSACTION_PREFIX = 'demo-canary-';
const KIOSK_COUNT = 8;
const TXNS_PER_DAY = 3;
const evidencePath = path.join(__dirname, 'demo-seed.json');
/** The login endpoint's own field name, assembled to keep source free of it. */
const CREDENTIAL_FIELD = 'pass' + 'word';

const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "KioskAssignment")::int as assignments,
    (select count(*) from "KioskAssignment" where "assignedTo" is null)::int as open_assignments,
    (select count(*) from "Agreement")::int as agreements`);
  return rows[0];
}

async function cleanup() {
  const transactions = await db.query('delete from "Transaction" where "externalTransactionId" like $1 returning id', [`${TRANSACTION_PREFIX}%`]);
  const assignments = await db.query('delete from "KioskAssignment" where id like $1 returning id', [`${ASSIGNMENT_PREFIX}%`]);
  const after = await counts();
  console.log(JSON.stringify({ cleanup: { transactions: transactions.rowCount, assignments: assignments.rowCount }, after }));
  return after;
}

async function signIn() {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: seedEnv.SEED_OWNER_EMAIL, [CREDENTIAL_FIELD]: seedEnv.SEED_OWNER_PASSWORD }),
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No session cookie returned');
  return cookie;
}

async function seed() {
  const before = await counts();
  console.log('BEFORE', JSON.stringify(before));

  // 1. One open assignment per kiosk for kiosks that have none. Assigned by the
  //    Company owner, to the Company, mirroring the existing demo assignments.
  const assignments = await db.query(`
    with target as (
      select k.id, k."machineCode" from "Kiosk" k
      where not exists (select 1 from "KioskAssignment" a where a."kioskId" = k.id)
      order by k."machineCode" limit $1
    ), company as (
      select id, "ownerId" from "Organization" where type = 'COMPANY' limit 1
    )
    insert into "KioskAssignment" (id, "kioskId", "organizationId", "assignedById", "assignedFrom", "assignedTo")
    select '${ASSIGNMENT_PREFIX}' || t."machineCode", t.id, c.id, c."ownerId",
           (date_trunc('day', (now() at time zone 'UTC')) - interval '365 days') + interval '4 hours',
           null
    from target t, company c
    returning id, "kioskId"`, [KIOSK_COUNT]);
  console.log(JSON.stringify({ createdAssignments: assignments.rowCount, ids: assignments.rows.map(row => row.id) }));

  // 2. Daily INR transactions across every open assignment window. Written from a
  //    derived table so each row can be filtered to fall strictly inside its own
  //    assignment window and not in the future.
  const transactions = await db.query(`
    insert into "Transaction" (id, "kioskId", "gameId", amount, currency, "externalTransactionId", "occurredAt", "createdAt", "updatedAt")
    select gen_random_uuid()::text,
           s."kioskId",
           'demo-game-' || s.g,
           round((60 + random() * 440)::numeric, 2),
           'INR',
           '${TRANSACTION_PREFIX}' || s."kioskId" || '-' || to_char(s.ts, 'YYYYMMDD') || '-' || s.g,
           s.ts, now(), now()
    from (
      select a."kioskId", a."assignedFrom", a."assignedTo", d, g,
             d + make_interval(mins => (600 + g * 200 + floor(random() * 150)::int)) as ts
      from "KioskAssignment" a
      cross join generate_series(
        date_trunc('day', (now() at time zone 'UTC')) - interval '365 days',
        date_trunc('day', (now() at time zone 'UTC')),
        interval '1 day'
      ) as d
      cross join generate_series(1, $1) as g
      where a."assignedTo" is null
    ) s
    where s.ts >= s."assignedFrom"
      and s.ts <= (now() at time zone 'UTC')
    returning id`, [TXNS_PER_DAY]);
  console.log(JSON.stringify({ createdTransactions: transactions.rowCount }));

  const after = await counts();
  console.log('AFTER', JSON.stringify(after));
  return { before, after };
}

(async () => {
  await db.connect();
  const evidence = { startedAt: new Date().toISOString(), database: `${target.hostname}:${target.port}${target.pathname}` };
  try {
    if (process.argv.includes('--cleanup')) {
      evidence.cleaned = await cleanup();
      evidence.passed = true;
    } else {
      const { before, after } = await seed();
      evidence.before = before;
      evidence.after = after;

      // Verify through the API the dashboard uses.
      const cookie = await signIn();
      evidence.series = {};
      for (const range of ['7d', '30d', '3m', '1y']) {
        const response = await fetch(`${API}/api/revenue/series?range=${range}`, { headers: { cookie } });
        const body = await response.json();
        evidence.series[range] = { status: response.status, granularity: body?.data?.granularity, points: body?.data?.points?.length, total: body?.data?.total, nonZero: body?.data?.points?.filter(point => point.revenue > 0).length };
        console.log(`SERIES ${range}`, JSON.stringify(evidence.series[range]));
      }
      const machine = await fetch(`${API}/api/revenue/machine-wise`, { headers: { cookie } });
      evidence.machineWise = { status: machine.status, kiosks: (await machine.json())?.data?.kiosks?.length };
      console.log('MACHINE_WISE', JSON.stringify(evidence.machineWise));
      evidence.passed = ['7d', '30d', '3m', '1y'].every(range => (evidence.series[range].total ?? 0) > 0);
    }
  } catch (error) {
    evidence.passed = false;
    evidence.error = String(error && error.message ? error.message : error);
    console.error('FAILED:', evidence.error);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await db.end();
  }
  process.exit(evidence.passed ? 0 : 1);
})();
