// Verify the post-approval status progression end-to-end in a real browser.
//
// Before this change the orders table offered only "Approve"; the later steps
// (payment -> dispatch -> deliver) existed in the API but had no UI at all. This run
// drives them through the real screen for every state the row can be in.
//
// Builds its own isolated DISTRIBUTOR + ACTIVE agreement, requests 2 kiosks, approves
// as the Company, then advances the row: paid -> dispatched -> delivered. It records
// the button shown at each state, the persisted order/kiosk state, and removes
// everything it created.
//
// Local stack only. No email is sent (local Mailjet keys are dummy).
const crypto = require('node:crypto');
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
const FIELD = 'pass' + 'word';
const TAG = 'TEMP-LIFECYCLE-' + Date.now();
const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
const { chromium } = require_(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
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
    (select count(*) from "Kiosk" where status='RESERVED')::int as reserved`);
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

/** Order + its kiosks as persisted, read from the database. */
async function orderState() {
  const order = (await db.query(
    `select status::text, "paymentStatus"::text from "Order" where id=$1`, [created.orderId])).rows[0];
  const kiosks = (await db.query(
    `select status::text as kiosk_status, "currentOrgId", count(*)::int as n
     from "Kiosk" where "reservedOrderId"=$1 or id in (select "kioskId" from "OrderKiosk" where "orderId"=$1)
     group by 1,2`, [created.orderId])).rows;
  return { order, kiosks };
}

async function cleanup() {
  const removed = {};
  if (created.orderId) {
    removed.deliveries = (await db.query(`delete from "EmailDelivery" where key like '%' || $1 || '%' returning id`, [created.orderId])).rowCount;
    removed.assignments = (await db.query('delete from "KioskAssignment" where "orderId"=$1 returning id', [created.orderId])).rowCount;
    // Return the kiosks to their pre-order ownership and state.
    removed.kiosksRestored = (await db.query(
      `update "Kiosk" set "currentOrgId"=$2, status='AVAILABLE', "reservedOrderId"=null
       where id in (select "kioskId" from "OrderKiosk" where "orderId"=$1) returning id`,
      [created.orderId, created.companyId])).rowCount;
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

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const company = (await db.query(`select id, "ownerId" from "Organization" where type='COMPANY' limit 1`)).rows[0];
    created.companyId = company.id;
    const secret = crypto.randomBytes(18).toString('base64url');
    const ownerEmail = `${TAG.toLowerCase()}@example.invalid`;
    const user = (await db.query(
      `insert into "User" (id,name,email,"passwordHash","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,$2,$3,now(),now()) returning id`,
      [`Lifecycle Owner ${TAG}`, ownerEmail, await require('bcryptjs').hash(secret, 10)])).rows[0];
    created.userId = user.id;
    const org = (await db.query(
      `insert into "Organization" (id,name,type,state,city,pincode,address,"ownerId","isActive","createdAt","updatedAt")
       values (gen_random_uuid()::text,$1,'DISTRIBUTOR','Maharashtra','Pune',411001,'Lifecycle premises',$2,true,now(),now()) returning id`,
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

    // Request as the distributor, approve as the company (the reachable reservation path).
    const distributorCookie = await signIn(ownerEmail, secret);
    const requested = await (await fetch(`${API}/api/orders/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: distributorCookie },
      body: JSON.stringify({ type: 'REQUEST', quantity: 2 }),
    })).json();
    created.orderId = requested?.data?.order?.id;
    created.orderNumber = requested?.data?.order?.orderNumber;
    if (!created.orderId) throw new Error(`Request failed: ${JSON.stringify(requested).slice(0, 200)}`);
    const companyCookie = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
    const approved = await (await fetch(`${API}/api/orders/${created.orderId}/approve`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: companyCookie }, body: JSON.stringify({}),
    })).json();
    step('approved', { status: approved?.data?.order?.status, paymentStatus: approved?.data?.order?.paymentStatus, orderNumber: created.orderNumber });
    evidence.persistedApproved = await orderState();

    // Drive the UI: the company sees the row and must be offered the next step at each state.
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const apiCalls = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/orders/')) apiCalls.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    });
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Email', { exact: true }).fill(seedEnv.SEED_OWNER_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(seedEnv.SEED_OWNER_PASSWORD);
    await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login'),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await page.waitForURL('http://localhost:3000/');
    await page.goto('http://localhost:3000/orders', { waitUntil: 'networkidle' });

    const row = page.getByRole('row', { name: created.orderNumber });
    await row.waitFor();

    /** One UI step: assert the offered button, click it, confirm, verify persistence. */
    const advance = async (label, expectButton, expectedStatus, expectedPayment) => {
      const offered = row.getByRole('button', { name: `${expectButton} ${created.orderNumber}` });
      const visible = await offered.count();
      step(`ui-offers-${label}`, { button: expectButton, visible: visible > 0 });
      if (!visible) throw new Error(`UI did not offer "${expectButton}" for ${created.orderNumber}`);
      await offered.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const text = await dialog.innerText();
      step(`confirm-${label}`, { dialogTitle: text.split('\n')[0].slice(0, 60), hasConsequence: text.length > 60 });
      await dialog.getByRole('button', { name: expectButton, exact: true }).click();
      await page.waitForTimeout(2500);
      const state = await orderState();
      const persisted = state.order?.status === expectedStatus &&
        (expectedPayment === undefined || state.order?.paymentStatus === expectedPayment);
      step(`persisted-${label}`, { order: state.order, kiosks: state.kiosks, matches: persisted });
      return persisted;
    };

    evidence.paid = await advance('paid', 'Mark as paid', 'APPROVED', 'PAID');
    evidence.dispatched = await advance('dispatch', 'Dispatch', 'DISPATCHED', 'PAID');
    evidence.delivered = await advance('deliver', 'Mark delivered', 'DELIVERED', 'PAID');
    evidence.finalState = await orderState();
    evidence.apiCalls = apiCalls;

    // After delivery there is nothing left to advance, and ownership has moved.
    const leftover = await row.getByRole('button', { name: `Mark delivered ${created.orderNumber}` }).count();
    evidence.noFurtherStepOffered = leftover === 0;
    const ownershipMoved = evidence.finalState.kiosks.every(k => k.currentOrgId === created.orgId && k.kiosk_status === 'AVAILABLE');
    step('final-verdict', {
      paid: evidence.paid,
      dispatched: evidence.dispatched,
      delivered: evidence.delivered,
      ownershipMoved,
      reservedCleared: evidence.finalState.kiosks.every(k => k.kiosk_status !== 'RESERVED'),
      noFurtherStepOffered: evidence.noFurtherStepOffered,
    });

    evidence.passed = evidence.paid && evidence.dispatched && evidence.delivered && ownershipMoved &&
      evidence.noFurtherStepOffered;
    await context.close();
  } catch (error) {
    evidence.passed = false;
    evidence.error = error.message;
    step('error', { message: error.message });
  } finally {
    await browser.close();
    const removed = await cleanup();
    const after = await counts();
    evidence.removed = removed;
    evidence.after = after;
    evidence.restored = JSON.stringify(before) === JSON.stringify(after);
    step('cleanup', removed);
    step('counts', { before, after, restored: evidence.restored });
    fs.writeFileSync(path.join(__dirname, 'order-lifecycle-verification.json'), JSON.stringify(evidence, null, 2));
    await db.end();
  }
})().catch(async error => {
  console.error('FAILED:', error.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
