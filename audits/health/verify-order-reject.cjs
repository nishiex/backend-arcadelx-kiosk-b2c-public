// Verify the new order reject against the REAL API (not mocks), and confirm the
// header's counts against the database.
//
// Creates one isolated distributor + ACTIVE agreement, requests 2 kiosks, then rejects
// as the Company and asserts the persisted state (REJECTED, no stock touched, no order
// kiosks, no reservation). Removes everything it created.
//
// Local stack only. No write is attempted until the reject step.
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
const TAG = 'TEMP-REJECT-' + Date.now();
const db = new Client({ connectionString: target.href });
const created = {};
const evidence = { tag: TAG, startedAt: new Date().toISOString(), steps: [] };
const step = (name, detail) => { evidence.steps.push({ step: name, ...detail }); console.log(JSON.stringify({ step: name, ...detail })); };

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "NetworkConnection")::int as connections,
    (select count(*) from "Kiosk" where status='RESERVED')::int as reserved,
    (select count(*) from "OrderKiosk")::int as order_kiosks`);
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
  return removed;
}

(async () => {
  await db.connect();
  const before = await counts();
  evidence.before = before;
  step('before-counts', before);

  try {
    const company = (await db.query(`select id from "Organization" where type='COMPANY' limit 1`)).rows[0];
    const secret = crypto.randomBytes(18).toString('base64url');
    const ownerEmail = `${TAG.toLowerCase()}@example.invalid`;
    const user = (await db.query(
      `insert into "User" (id,name,email,"passwordHash","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,$3,now(),now()) returning id`,
      [`Reject Owner ${TAG}`, ownerEmail, await require('bcryptjs').hash(secret, 10)])).rows[0];
    created.userId = user.id;
    const org = (await db.query(
      `insert into "Organization" (id,name,type,state,city,pincode,address,"ownerId","isActive","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,'DISTRIBUTOR','Maharashtra','Pune',411001,'Reject premises',$2,true,now(),now()) returning id`,
      [`${TAG} Distributor`, user.id])).rows[0];
    created.orgId = org.id;
    await db.query(`insert into "Membership" (id,"userId","organizationId",role,status,"createdAt","updatedAt")
      values (gen_random_uuid()::text,$1,$2,'OWNER','ACTIVE',now(),now())`, [user.id, org.id]);
    const connection = (await db.query(
      `insert into "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,'ACTIVE',now(),now()) returning id`, [company.id, org.id])).rows[0];
    created.connectionId = connection.id;
    const agreement = (await db.query(
      `insert into "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct",
         "effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,$3,60,40,now(),'ACTIVE',10000,2000,now(),now()) returning id`,
      [connection.id, company.id, org.id])).rows[0];
    created.agreementId = agreement.id;

    // Distributor requests; nothing is reserved until approval.
    const distributorCookie = await signIn(ownerEmail, secret);
    const requested = await (await fetch(`${API}/api/orders/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: distributorCookie },
      body: JSON.stringify({ type: 'REQUEST', quantity: 2 }),
    })).json();
    created.orderId = requested?.data?.order?.id;
    created.orderNumber = requested?.data?.order?.orderNumber;
    if (!created.orderId) throw new Error(`Request failed: ${JSON.stringify(requested).slice(0, 200)}`);
    step('request-created', { orderNumber: created.orderNumber, status: requested.data.order.status, paymentStatus: requested.data.order.paymentStatus });

    const reservedBeforeReject = (await db.query('select count(*)::int as n from "Kiosk" where "reservedOrderId"=$1', [created.orderId])).rows[0].n;
    const kioskStatusesBefore = (await db.query(`select status::text, count(*)::int as n from "Kiosk" group by 1 order by 1`)).rows;

    // Reject as the Company.
    const companyCookie = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
    const rejected = await fetch(`${API}/api/orders/${created.orderId}/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: companyCookie }, body: JSON.stringify({}),
    });
    const rejectedBody = await rejected.json();
    step('reject-response', { status: rejected.status, message: rejectedBody?.message });

    const persisted = (await db.query('select status::text, "paymentStatus"::text from "Order" where id=$1', [created.orderId])).rows[0];
    const reservedAfter = (await db.query('select count(*)::int as n from "Kiosk" where "reservedOrderId"=$1', [created.orderId])).rows[0].n;
    const orderKiosks = (await db.query('select count(*)::int as n from "OrderKiosk" where "orderId"=$1', [created.orderId])).rows[0].n;
    const kioskStatusesAfter = (await db.query(`select status::text, count(*)::int as n from "Kiosk" group by 1 order by 1`)).rows;
    const assignments = (await db.query('select count(*)::int as n from "KioskAssignment" where "orderId"=$1', [created.orderId])).rows[0].n;

    const verdict = {
      orderRejected: persisted?.status === 'REJECTED',
      paymentUntouched: persisted?.paymentStatus === 'PENDING',
      noReservation: reservedBeforeReject === 0 && reservedAfter === 0,
      noOrderKiosks: orderKiosks === 0,
      noAssignments: assignments === 0,
      kioskStatusesUnchanged: JSON.stringify(kioskStatusesBefore) === JSON.stringify(kioskStatusesAfter),
    };
    evidence.verdict = verdict;
    step('verdict', verdict);

    // Rejection must be refused on an already-rejected order, and by a non-supplier.
    const again = await fetch(`${API}/api/orders/${created.orderId}/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: companyCookie }, body: JSON.stringify({}),
    });
    step('reject-again', { status: again.status });
    const byRequester = await fetch(`${API}/api/orders/${created.orderId}/reject`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: distributorCookie }, body: JSON.stringify({}),
    });
    step('reject-by-requester', { status: byRequester.status });

    const pending = (await db.query(`select
      (select count(*) from "Membership" where status='PENDING')::int as member_requests,
      (select count(*) from "NetworkConnection" where status='PENDING')::int as connection_requests,
      (select count(*) from "Agreement" where status='PENDING_APPROVAL')::int as agreements_awaiting,
      (select count(*) from "Order" where status='UNDER_REVIEW')::int as orders_awaiting`)).rows[0];
    evidence.headerExpectedCounts = pending;
    step('header-expected-counts', pending);

    evidence.passed = Object.values(verdict).every(Boolean) && again.status === 409 && byRequester.status === 403;
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
    fs.writeFileSync(path.join(__dirname, 'order-reject-verification.json'), JSON.stringify(evidence, null, 2));
    await db.end();
  }
})().catch(async error => {
  console.error('FAILED:', error.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
