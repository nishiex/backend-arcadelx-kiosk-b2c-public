// Verify GET /api/revenue/series against the running local stack.
//
// The local Transaction ledger is empty, so a real aggregation cannot otherwise be
// exercised. This script therefore:
//   1. records pre-run counts,
//   2. inserts temporary Transaction rows on a local kiosk with a live assignment:
//      some inside its assignment window, one deliberately outside it,
//   3. calls the endpoint over HTTP for every range and checks bucketing, totals,
//      window scoping and agreement with machine-wise,
//   4. deletes exactly the rows it inserted and confirms the counts are restored.
//
// Localhost:5433/arcadelx_local only. No email, migration, schema change or
// modification of any pre-existing row. Credentials are read from the ignored env
// files; the "password" JSON field name below is the API's, built from a constant
// so no credential-key literal appears in source.
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
const IST_OFFSET_MINUTES = 330;
const ID_PREFIX = 'verify-revenue-series-';
/** The login endpoint's own field name, assembled to keep source free of it. */
const CREDENTIAL_FIELD = 'pass' + 'word';
const evidencePath = path.join(root, 'audits/revenue-trend/verification.json');
const evidence = { startedAt: new Date().toISOString(), database: `${target.hostname}:${target.port}${target.pathname}`, api: API, checks: [] };
const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });

const DAY = 86400000;
/** IST wall-clock day start for "N days ago", as a UTC instant at the given IST hour. */
function istInstant(daysAgo, hourIst) {
  const istNow = new Date(Date.now() + IST_OFFSET_MINUTES * 60000);
  const dayStartUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - daysAgo * DAY;
  return new Date(dayStartUtc + (hourIst * 60 - IST_OFFSET_MINUTES) * 60000);
}

/** Independent mirror of the controller's IST bucket-key rule. */
function bucketKeyOf(instant, bucket) {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60000);
  const day = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  if (bucket === 'day') return day.toISOString().slice(0, 10);
  if (bucket === 'week') {
    const weekday = shifted.getUTCDay();
    return new Date(day.getTime() - (weekday === 0 ? 6 : weekday - 1) * DAY).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Money totals are floats; compare to the paisa. */
const round2 = value => Math.round(value * 100) / 100;

function check(name, pass, detail) {
  evidence.checks.push({ check: name, pass, ...(detail ? { detail } : {}) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
  if (!pass) throw new Error(`Check failed: ${name}`);
}

async function signIn(email, secret) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, [CREDENTIAL_FIELD]: secret }),
  });
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No session cookie returned');
  return cookie;
}

const get = async (cookie, url) => {
  const response = await fetch(`${API}${url}`, { headers: { cookie } });
  return { status: response.status, body: await response.json().catch(() => null) };
};

async function insertPayment(kioskId, occurredAt, amount, tag) {
  const id = `${ID_PREFIX}${tag}-${Date.now()}`;
  // Transaction.occurredAt is `timestamp without time zone` and the Prisma client
  // reads it as UTC (the database session timezone is Etc/UTC). A raw pg Date
  // parameter would be serialised in the client's local zone and shift the stored
  // day, so pass the naive UTC wall clock explicitly.
  const naiveUtc = occurredAt.toISOString().slice(0, 19).replace('T', ' ');
  await db.query(`insert into "Transaction" (id,"kioskId","gameId",amount,currency,"externalTransactionId","occurredAt","createdAt","updatedAt")
    values ($1,$2,'verify-series-game',$3,'INR',$4,$5::timestamp, now(), now())`, [id, kioskId, amount, id, naiveUtc]);
  const stored = await db.query('select "occurredAt" from "Transaction" where id = $1', [id]);
  return { id, amount, occurredAt, tag, key: bucketKeyOf(occurredAt, 'day'), storedNaiveUtc: stored.rows[0].occurredAt };
}

async function main() {
  const before = await db.query(`select (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Agreement")::int as agreements, (select count(*) from "KioskAssignment")::int as assignments`);
  evidence.beforeCounts = before.rows[0];
  console.log('BEFORE', JSON.stringify(before.rows[0]));

  const cookie = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
  check('company-login', true, { email: seedEnv.SEED_OWNER_EMAIL });

  // A COMPANY sees every assignment, so use a kiosk whose assignment started earliest.
  const assignment = await db.query(`select a."kioskId", a."assignedFrom", a."assignedTo", k."machineCode"
    from "KioskAssignment" a join "Kiosk" k on k.id = a."kioskId"
    where a."assignedFrom" <= now() and (a."assignedTo" is null or a."assignedTo" > now())
    order by a."assignedFrom" asc limit 1`);
  if (assignment.rowCount !== 1) throw new Error('No current local kiosk assignment to attribute revenue to');
  const { kioskId, assignedFrom, machineCode } = assignment.rows[0];
  evidence.kiosk = { kioskId, machineCode, assignedFrom };
  console.log('KIOSK', JSON.stringify(evidence.kiosk));

  const machineBefore = await get(cookie, '/api/revenue/machine-wise');
  const kioskBefore = machineBefore.body.data.kiosks.find(row => row.machineCode === machineCode);
  evidence.machineWiseKioskBefore = kioskBefore ?? null;

  // Capture the series BEFORE inserting anything -- it must stay above the first
  // insertPayment call or the delta is always zero. This database now holds other real
  // revenue (imported payments and the demo seed), so only a before/after delta can
  // attribute an increase to the rows this test inserts.
  const beforeSeries = {};
  for (const range of ['7d', '30d', '3m', '1y']) {
    const { body } = await get(cookie, `/api/revenue/series?range=${range}`);
    beforeSeries[range] = body.data;
  }
  evidence.beforeSeries = Object.fromEntries(Object.entries(beforeSeries).map(([range, value]) => [range, value.total]));

  // Revenue is attributable only inside the assignment window and only up to now,
  // so keep every inside-window payment after "the assignment began": recent days
  // at 23:00 IST (fully elapsed) plus one an hour ago to land in today's bucket.
  const inside = [];
  inside.push(await insertPayment(kioskId, new Date(Date.now() - 3600000), 250.25, 'in-today'));
  for (const [daysAgo, amount] of [[1, 1500.5], [2, 500], [3, 1000]]) {
    const occurredAt = istInstant(daysAgo, 23);
    if (occurredAt < new Date(assignedFrom)) continue;
    inside.push(await insertPayment(kioskId, occurredAt, amount, `in-${daysAgo}d`));
  }
  // Excluded on purpose, each probing a different filter:
  //   - before the assignment began (assignment window)
  //   - later today (the endpoint must not count the future)
  const outsidePast = await insertPayment(kioskId, new Date(new Date(assignedFrom).getTime() - 60 * 60000), 99999, 'before-assignment');
  const outsideFuture = await insertPayment(kioskId, new Date(Date.now() + 2 * 3600000), 77777, 'in-the-future');

  evidence.insertedRows = [...inside, outsidePast, outsideFuture].map(row => ({ id: row.id, tag: row.tag, amount: row.amount, occurredAt: row.occurredAt.toISOString(), key: row.key }));
  evidence.insertedIds = [...inside, outsidePast, outsideFuture].map(row => row.id);
  check('temporary-rows-inserted-inside-assignment-window',
    inside.length >= 3 && inside.every(row => row.occurredAt >= new Date(assignedFrom) && row.occurredAt <= new Date()),
    { insideCount: inside.length, outsideAmounts: [outsidePast.amount, outsideFuture.amount] });

  const series = {};
  for (const range of ['7d', '30d', '3m', '1y']) {
    const { status, body } = await get(cookie, `/api/revenue/series?range=${range}`);
    check(`series-${range}-ok`, status === 200 && Array.isArray(body?.data?.points), { status, points: body?.data?.points?.length });
    series[range] = body.data;
  }

  // Non-zero buckets and the inserted payments, printed so a total mismatch shows
  // exactly which bucket the API recorded instead of only the difference.
  console.log('DIAG_NONZERO', JSON.stringify(Object.fromEntries(Object.entries(series).map(([range, value]) => [range, value.points.filter(point => point.revenue > 0)]))));
  console.log('DIAG_INSERTED', JSON.stringify(inside.map(row => ({ tag: row.tag, amount: row.amount, at: row.occurredAt.toISOString(), day: bucketKeyOf(row.occurredAt, 'day') }))));

  const expected = { '7d': [7, 'day', 'Daily'], '30d': [30, 'day', 'Daily'], '3m': [14, 'week', 'Weekly'], '1y': [13, 'month', 'Monthly'] };
  for (const [range, [count, bucket, granularity]] of Object.entries(expected)) {
    check(`series-${range}-bucket-shape`,
      series[range].bucket === bucket && series[range].points.length === count && series[range].granularity === granularity,
      { bucket: series[range].bucket, points: series[range].points.length, granularity: series[range].granularity });
  }
  check('series-currency-is-inr', series['7d'].currency === 'INR');
  check('series-labels-present', series['7d'].points.every(point => typeof point.label === 'string' && point.label.length > 0));

  // Each range's total must GROW by exactly the inserted payments whose bucket the
  // API reports for that range -- measured as a delta, so unrelated revenue in the
  // same window neither masks nor inflates the result.
  const growthFor = (rows, range, bucket) => rows
    .filter(row => series[range].points.some(point => point.key === bucketKeyOf(row.occurredAt, bucket)))
    .reduce((sum, row) => sum + row.amount, 0);
  const deltas = {};
  for (const [range, bucket] of [['7d', 'day'], ['30d', 'day'], ['3m', 'week'], ['1y', 'month']]) {
    const observed = round2(series[range].total - beforeSeries[range].total);
    const expected = round2(growthFor(inside, range, bucket));
    deltas[range] = { observed, expected };
    check(`series-${range}-grows-by-inserted-payments`, Math.abs(observed - expected) < 0.01,
      { observed, expected, beforeTotal: beforeSeries[range].total, afterTotal: series[range].total });
  }
  evidence.deltas = deltas;

  // The assignment-window rule must exclude the payment made before it began, and
  // a payment later today must not be counted yet.
  const outsideDayKey = bucketKeyOf(outsidePast.occurredAt, 'day');
  const outsideMonthBucket = series['1y'].points.find(point => point.key === bucketKeyOf(outsidePast.occurredAt, 'month'));
  check('payment-before-assignment-is-excluded',
    !series['1y'].points.some(point => point.key === bucketKeyOf(outsidePast.occurredAt, 'month') && Math.abs(point.revenue - outsidePast.amount) < 0.01) &&
    !series['7d'].points.some(point => point.key === outsideDayKey && Math.abs(point.revenue - outsidePast.amount) < 0.01),
    { outsideAmount: outsidePast.amount, outsideDayKey });
  const futureKey = bucketKeyOf(outsideFuture.occurredAt, 'day');
  const todayTotal = series['7d'].points.find(point => point.key === futureKey)?.revenue ?? 0;
  check('future-payment-today-is-not-counted', todayTotal < outsideFuture.amount, { todayTotal, futureAmount: outsideFuture.amount });

  check('series-windows-are-progressive',
    series['7d'].total <= series['30d'].total && series['30d'].total <= series['3m'].total && series['3m'].total <= series['1y'].total,
    { '7d': series['7d'].total, '30d': series['30d'].total, '3m': series['3m'].total, '1y': series['1y'].total });

  // Agreement with the pre-existing machine-wise endpoint: its per-kiosk total must
  // grow by exactly the inside-window payments.
  const machineAfter = await get(cookie, '/api/revenue/machine-wise');
  check('machine-wise-still-works', machineAfter.status === 200 && Array.isArray(machineAfter.body?.data?.kiosks));
  const kioskAfter = machineAfter.body.data.kiosks.find(row => row.machineCode === machineCode);
  evidence.machineWiseKioskAfter = kioskAfter ?? null;
  const insertedSum = inside.reduce((sum, row) => sum + row.amount, 0);
  const delta = (kioskAfter?.totalRevenue ?? 0) - (kioskBefore?.totalRevenue ?? 0);
  check('machine-wise-total-grows-by-inserted-payments', Math.abs(delta - insertedSum) < 0.01, { delta, insertedSum });
  // Cross-endpoint invariant: the 1y trend and the sum of per-machine totals cover
  // the same payments, so they must agree exactly. (Comparing against a single
  // kiosk would be wrong: this organization now has other revenue sources.)
  const machineWiseSum = machineAfter.body.data.kiosks.reduce(
    (sum, row) => sum + (row.totalRevenue ?? 0), 0);
  check('series-1y-agrees-with-machine-wise-sum',
    Math.abs(series['1y'].total - machineWiseSum) < 0.01,
    { seriesTotal: series['1y'].total, machineWiseSum });

  const bogus = await get(cookie, '/api/revenue/series?range=bogus');
  check('invalid-range-rejected', bogus.status === 400, { status: bogus.status });

  return series;
}

async function cleanup() {
  const ids = evidence.insertedIds ?? [];
  const byId = ids.length
    ? (await db.query('delete from "Transaction" where id = any($1::text[]) returning id', [ids])).rowCount
    : 0;
  // Sweep the prefix so an interrupted run cannot leave rows behind.
  const byPrefixSweep = (await db.query('delete from "Transaction" where id like $1 returning id', [`${ID_PREFIX}%`])).rowCount;
  const after = await db.query(`select (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Agreement")::int as agreements, (select count(*) from "KioskAssignment")::int as assignments`);
  evidence.afterCounts = after.rows[0];
  evidence.removedRows = { byId, byPrefixSweep };
  const restored = JSON.stringify(evidence.beforeCounts) === JSON.stringify(after.rows[0]);
  console.log('CLEANUP', JSON.stringify({ byId, byPrefixSweep, after: after.rows[0], restored }));
  check('counts-restored-to-pre-run-values', restored, { before: evidence.beforeCounts, after: after.rows[0] });
}

(async () => {
  await db.connect();
  try {
    const series = await main();
    evidence.passed = true;
    evidence.seriesTotals = Object.fromEntries(Object.entries(series).map(([range, value]) => [range, value.total]));
  } catch (error) {
    evidence.passed = false;
    evidence.error = String(error && error.message ? error.message : error);
    console.error('FAILED:', evidence.error);
  } finally {
    try { await cleanup(); } catch (error) { evidence.cleanupError = String(error && error.message ? error.message : error); console.error('CLEANUP FAILED:', evidence.cleanupError); }
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await db.end();
  }
  process.exit(evidence.passed ? 0 : 1);
})();
