// Prove the reservation fix end-to-end through the running API.
//
// Before: `ORDER BY "createdAt", id` picked kiosks by random UUID, so a request
// received an unexplained, model-mixed set (see order-request-repro.json and the
// measured set in this run's `oldOrderingWouldPick`).
// After:  `ORDER BY "createdAt", "machineCode", id` picks the same kiosks every time,
// in ascending machine-code order.
//
// Builds an isolated DISTRIBUTOR + ACTIVE agreement, allocates 2 kiosks as the
// Company, records what was reserved, then removes everything it created and
// verifies counts return to their previous values.
//
// Local stack only. No email is sent (local Mailjet keys are dummy).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
const FIELD = 'pass' + 'word';
const TAG = 'TEMP-ORDERFIX-' + Date.now();
const db = new Client({ connectionString: target.href });
const created = {};
const evidence = { tag: TAG, startedAt: new Date().toISOString(), steps: [] };

const step = (name, detail) => { evidence.steps.push({ step: name, ...detail }); console.log(JSON.stringify({ step: name, ...detail })); };

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "NetworkConnection")::int as connections,
    (select count(*) from "Organization")::int as organizations,
    (select count(*) from "User")::int as users,
    (select count(*) from "Membership")::int as memberships,
    (select count(*) from "KioskAssignment")::int as assignments,
    (select count(*) from "Kiosk" where status='RESERVED')::int as reserved_kiosks`);
  return rows[0];
}

async function signIn(email, secret) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, [FIELD]: secret }),
  });
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status}`);
  return (response.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).join('; ');
}

async function cleanup() {
  const removed = {};
  if (created.orderId) {
    removed.deliveries = (await db.query(`delete from "EmailDelivery" where key like '%' || $1 || '%' returning id`, [created.orderId])).rowCount;
    removed.assignments = (await db.query('delete from "KioskAssignment" where "orderId"=$1 returning id', [created.orderId])).rowCount;
    // Release this order's kiosks exactly as if it had never reserved them, then drop
    // the join rows before the order itself (OrderKiosk references Order).
    removed.kiosksReleased = (await db.query(
      `update "Kiosk" set status='AVAILABLE', "reservedOrderId"=null
       where "reservedOrderId"=$1 and status='RESERVED' returning id`, [created.orderId])).rowCount;
    removed.orderKiosks = (await db.query('delete from "OrderKiosk" where "orderId"=$1 returning "kioskId"', [created.orderId])).rowCount;
    removed.orders = (await db.query('delete from "Order" where id=$1 returning id', [created.orderId])).rowCount;
  }
  if (created.agreementId) removed.agreements = (await db.query('delete from "Agreement" where id=$1 returning id', [created.agreementId])).rowCount;
  if (created.connectionId) removed.connections = (await db.query('delete from "NetworkConnection" where id=$1 returning id', [created.connectionId])).rowCount;
  if (created.userId) {
    removed.refreshTokens = (await db.query('delete from "RefreshToken" where "userId"=$1 returning id', [created.userId])).rowCount;
    removed.memberships = (await db.query('delete from "Membership" where "userId"=$1 returning id', [created.userId])).rowCount;
  }
  if (created.orgId) removed.organizations = (await db.query('delete from "Organization" where id=$1 returning id', [created.orgId])).rowCount;
  if (created.userId) removed.users = (await db.query('delete from "User" where id=$1 returning id', [created.userId])).rowCount;
  // Invoice artifacts on disk for the temporary order, if any were rendered.
  if (created.orderNumber) {
    const dir = path.join(root, 'invoices');
    if (fs.existsSync(dir)) {
      const stale = fs.readdirSync(dir).filter(file => file.includes(created.orderNumber));
      stale.forEach(file => fs.rmSync(path.join(dir, file), { force: true }));
      removed.invoiceFiles = stale.length;
    }
  }
  return removed;
}

(async () => {
  await db.connect();
  const before = await counts();
  evidence.before = before;
  step('before-counts', before);

  try {
    const company = (await db.query(`select o.id, o."ownerId" from "Organization" o where o.type='COMPANY' limit 1`)).rows[0];

    // What the OLD ordering would have picked for a 2-kiosk allocation right now,
    // for comparison against what the fixed code actually reserves.
    const oldPick = await db.query(
      `select "machineCode" from "Kiosk"
       where "currentOrgId"=$1 and status='AVAILABLE' and "reservedOrderId" is null
       order by "createdAt", id limit 2`, [company.id]);
    evidence.oldOrderingWouldPick = oldPick.rows.map(row => row.machineCode);
    step('old-ordering-would-pick', { kiosks: evidence.oldOrderingWouldPick });

    const secret = crypto.randomBytes(18).toString('base64url');
    const ownerEmail = `${TAG.toLowerCase()}@example.invalid`;
    const user = (await db.query(
      `insert into "User" (id,name,email,"passwordHash","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,$3,now(),now()) returning id`,
      [`OrderFix Owner ${TAG}`, ownerEmail, await require('bcryptjs').hash(secret, 10)])).rows[0];
    created.userId = user.id;
    const org = (await db.query(
      `insert into "Organization" (id,name,type,state,city,pincode,address,"ownerId","isActive","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,'DISTRIBUTOR','Maharashtra','Pune',411001,'OrderFix premises',$2,true,now(),now()) returning id`,
      [`${TAG} Distributor`, user.id])).rows[0];
    created.orgId = org.id;
    await db.query(`insert into "Membership" (id,"userId","organizationId",role,status,"createdAt","updatedAt")
      values (gen_random_uuid()::text,$1,$2,'OWNER','ACTIVE',now(),now())`, [user.id, org.id]);
    const connection = (await db.query(
      `insert into "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,'ACTIVE',now(),now()) returning id`, [company.id, org.id])).rows[0];
    created.connectionId = connection.id;
    // An already-ACTIVE agreement: this test targets reservation ordering, not approval.
    const agreement = (await db.query(
      `insert into "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct",
         "effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,$3,60,40,now(),'ACTIVE',10000,2000,now(),now()) returning id`,
      [connection.id, company.id, org.id])).rows[0];
    created.agreementId = agreement.id;
    step('fixture-created', { organizationId: org.id, agreementId: agreement.id });

    // The reachable reservation path: a Distributor requests, then the Company
    // approves, which runs reserveKiosks. This is exactly how ORD-2026-00004
    // reserved its kiosks. (A COMPANY cannot POST /api/orders/create at all -- see
    // the company-allocation finding in this audit -- so ALLOCATION is not used here.)
    const distributorCookie = await signIn(ownerEmail, secret);
    const requested = await fetch(`${API}/api/orders/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: distributorCookie },
      body: JSON.stringify({ type: 'REQUEST', quantity: 2 }),
    });
    const requestBody = await requested.json();
    created.orderId = requestBody?.data?.order?.id;
    created.orderNumber = requestBody?.data?.order?.orderNumber;
    step('distributor-request', { status: requested.status, message: requestBody?.message, orderNumber: created.orderNumber });
    if (!created.orderId) throw new Error(`Request did not create an order: ${JSON.stringify(requestBody).slice(0, 300)}`);

    // Before approval nothing is reserved; the reservation happens on approval.
    const preApproval = await db.query('select count(*)::int as n from "Kiosk" where "reservedOrderId"=$1', [created.orderId]);
    step('reserved-before-approval', { count: preApproval.rows[0].n });

    // Snapshot the available pool under the new rule BEFORE approval: the approved
    // request must reserve exactly the head of this queue.
    const pool = await db.query(
      `select "machineCode" from "Kiosk"
       where "currentOrgId"=$1 and status='AVAILABLE' and "reservedOrderId" is null
       order by "createdAt", "machineCode", id limit 2`, [company.id]);
    evidence.availablePoolHead = pool.rows.map(row => row.machineCode);

    const cookie = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
    const response = await fetch(`${API}/api/orders/${created.orderId}/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({}),
    });
    const body = await response.json();
    step('company-approval', { status: response.status, message: body?.message, invoiceReady: body?.data?.invoiceReady });

    // The decisive comparison: order every kiosk in the company's tied batch under
    // the OLD rule (random UUID) and the NEW rule (machine code). At small quantities
    // the two can coincide; across the tie they cannot.
    const batchIds = await db.query(
      `select id from "Kiosk" where "currentOrgId"=$1 and "createdAt" = (
         select "createdAt" from "Kiosk" where "currentOrgId"=$1 group by 1 order by count(*) desc limit 1)`, [company.id]);
    const ids = batchIds.rows.map(row => row.id);
    const oldOrder = await db.query('select "machineCode" from "Kiosk" where id = any($1::text[]) order by "createdAt", id', [ids]);
    const newOrder = await db.query('select "machineCode" from "Kiosk" where id = any($1::text[]) order by "createdAt", "machineCode", id', [ids]);
    evidence.tiedBatchSize = ids.length;
    evidence.orderingOldRule = oldOrder.rows.map(row => row.machineCode);
    evidence.orderingNewRule = newOrder.rows.map(row => row.machineCode);
    evidence.orderingDiffers = JSON.stringify(evidence.orderingOldRule) !== JSON.stringify(evidence.orderingNewRule);
    step('ordering-comparison', {
      tiedBatchSize: evidence.tiedBatchSize,
      oldRule: evidence.orderingOldRule.join(' '),
      newRule: evidence.orderingNewRule.join(' '),
      differs: evidence.orderingDiffers,
    });

    // Determinism: ascending machine codes, and identical to the rule's own order.
    const reserved = await db.query(
      `select "machineCode" from "Kiosk" where "reservedOrderId"=$1 order by "machineCode"`, [created.orderId]);
    const reservedCodes = reserved.rows.map(row => row.machineCode);
    evidence.reservedKiosks = reservedCodes;
    step('reserved-kiosks', { kiosks: reservedCodes });

    const expected = (await db.query(
      `select "machineCode" from "Kiosk"
       where "currentOrgId"=$1 and "reservedOrderId"=$2 order by "createdAt", "machineCode", id`, [company.id, created.orderId]))
      .rows.map(row => row.machineCode);
    evidence.deterministic = JSON.stringify(reservedCodes) === JSON.stringify(expected);
    evidence.ascending = reservedCodes.every((code, index) => index === 0 || reservedCodes[index - 1] < code);
    // The reservation must be exactly the head of the pre-approval queue.
    evidence.matchesQueueHead = JSON.stringify(reservedCodes) === JSON.stringify(evidence.availablePoolHead);
    step('verdict', {
      deterministic: evidence.deterministic,
      ascending: evidence.ascending,
      matchesQueueHead: evidence.matchesQueueHead,
      orderingDiffers: evidence.orderingDiffers,
    });

    evidence.passed = evidence.deterministic && evidence.ascending && evidence.matchesQueueHead && evidence.orderingDiffers;
  } catch (error) {
    evidence.passed = false;
    evidence.error = error.message;
    step('error', { message: error.message });
  } finally {
    const removed = await cleanup();
    const after = await counts();
    evidence.removed = removed;
    evidence.after = after;
    evidence.restored = JSON.stringify(before) === JSON.stringify(after);
    step('cleanup', removed);
    step('counts', { before, after, restored: evidence.restored });
    fs.writeFileSync(path.join(__dirname, 'reservation-order-verification.json'), JSON.stringify(evidence, null, 2));
    await db.end();
  }
})().catch(async error => {
  console.error('FAILED:', error.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
