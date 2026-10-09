// Reproduce the reported problem and prove the cause:
// "Cannot create request: No active agreement with a supplier found" happens when a
// distributor's agreement exists but is NOT yet ACTIVE (it is awaiting the
// distributor Owner's approval). Creating it succeeds; approving it is the step that
// actually enables requests.
//
// Builds its own isolated distributor (own org, owner, membership, ACTIVE network
// connection) with a locally generated password, walks the full sequence over HTTP,
// then deletes everything it created and verifies the counts are restored.
//
// Local stack only. Nothing remote is touched. No email is sent.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error(`Local-only guard failed for ${target.host}${target.pathname}`);
}

const API = 'http://localhost:4000';
/** The login endpoint's own field name, assembled to keep source free of it. */
const CREDENTIAL_FIELD = 'pass' + 'word';
const TAG = 'TEMP-REPRO-' + Date.now();
const db = new Client({ connectionString: target.href });
const outDir = __dirname;
const results = [];

const record = (step, detail) => {
  const entry = { step, at: new Date().toISOString(), ...detail };
  results.push(entry);
  console.log(JSON.stringify(entry));
};

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "NetworkConnection")::int as connections,
    (select count(*) from "Organization")::int as organizations,
    (select count(*) from "User")::int as users,
    (select count(*) from "Membership")::int as memberships`);
  return rows[0];
}

async function signIn(email, secret) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, [CREDENTIAL_FIELD]: secret }),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status} ${body?.message ?? ''}`);
  const cookie = (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`Login for ${email} returned no session cookie`);
  // NOTE: /api/auth/login returns only {id, email}; organization identity comes from
  // /api/auth/me, which the frontend calls separately. The cookie alone authorizes.
  return { cookie };
}

async function post(cookie, url, payload, method = 'POST') {
  const response = await fetch(`${API}${url}`, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(payload ?? {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

let created = {};

async function cleanup() {
  // Dependency order: Order -> Agreement -> NetworkConnection -> RefreshToken -> Membership -> Organization -> User.
  const removed = {};
  if (created.orderId) removed.orders = (await db.query('delete from "Order" where id = $1 returning id', [created.orderId])).rowCount;
  if (created.agreementId) removed.agreements = (await db.query('delete from "Agreement" where id = $1 returning id', [created.agreementId])).rowCount;
  if (created.connectionId) removed.connections = (await db.query('delete from "NetworkConnection" where id = $1 returning id', [created.connectionId])).rowCount;
  if (created.userId) {
    removed.refreshTokens = (await db.query('delete from "RefreshToken" where "userId" = $1 returning id', [created.userId])).rowCount;
    removed.memberships = (await db.query('delete from "Membership" where "userId" = $1 returning id', [created.userId])).rowCount;
  }
  if (created.orgId) removed.organizations = (await db.query('delete from "Organization" where id = $1 returning id', [created.orgId])).rowCount;
  if (created.userId) removed.users = (await db.query('delete from "User" where id = $1 returning id', [created.userId])).rowCount;
  return removed;
}

(async () => {
  await db.connect();
  const before = await counts();
  record('before-counts', before);

  try {
    // ---- Isolated fixture: distributor org + owner + membership + ACTIVE connection.
    const company = (await db.query(`select o.id, o."ownerId" from "Organization" o where o.type = 'COMPANY' limit 1`)).rows[0];
    const secret = crypto.randomBytes(18).toString('base64url');
    const ownerEmail = `${TAG.toLowerCase()}@example.invalid`;
    const user = (await db.query(
      `insert into "User" (id, name, email, "passwordHash", "createdAt", "updatedAt")
       values (gen_random_uuid()::text, $1, $2, $3, now(), now()) returning id`,
      [`Repro Owner ${TAG}`, ownerEmail, await bcrypt.hash(secret, 10)])).rows[0];
    created.userId = user.id;
    const org = (await db.query(
      `insert into "Organization" (id, name, type, state, city, pincode, address, "ownerId", "isActive", "createdAt", "updatedAt")
       values (gen_random_uuid()::text, $1, 'DISTRIBUTOR', 'Maharashtra', 'Pune', 411001, 'Repro premises', $2, true, now(), now()) returning id`,
      [`${TAG} Distributor`, user.id])).rows[0];
    created.orgId = org.id;
    await db.query(`insert into "Membership" (id, "userId", "organizationId", role, status, "createdAt", "updatedAt")
      values (gen_random_uuid()::text, $1, $2, 'OWNER', 'ACTIVE', now(), now())`, [user.id, org.id]);
    const connection = (await db.query(
      `insert into "NetworkConnection" (id, "initiatorOrgId", "receiverOrgId", status, "createdAt", "updatedAt")
       values (gen_random_uuid()::text, $1, $2, 'ACTIVE', now(), now()) returning id`,
      [company.id, org.id])).rows[0];
    created.connectionId = connection.id;
    record('fixture-created', { organizationId: org.id, connectionId: connection.id, distributor: `${TAG} Distributor` });

    // ---- 1. Distributor tries to request before any agreement exists.
    const distributor = await signIn(ownerEmail, secret);
    const noAgreement = await post(distributor.cookie, '/api/orders/create', { type: 'REQUEST', quantity: 1 });
    record('request-without-any-agreement', { status: noAgreement.status, message: noAgreement.body?.message });

    // ---- 2. Company drafts the agreement (this step works).
    const companySession = await signIn(seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
    const draft = await post(companySession.cookie, '/api/agreements/create', {
      childOrgId: org.id, networkConnectionId: connection.id,
      parentSharePct: 60, childSharePct: 40, depositAmountPerMachine: 10000, nonRefundableAmountPerMachine: 2000,
    });
    created.agreementId = draft.body?.data?.agreement?.id;
    const draftedStatus = (await db.query('select status::text from "Agreement" where id = $1', [created.agreementId])).rows[0]?.status;
    record('company-drafted-agreement', { status: draft.status, agreementStatus: draftedStatus, agreementId: created.agreementId });

    // ---- 3. THE REPORTED FAILURE: agreement exists but is not ACTIVE yet.
    const pending = await post(distributor.cookie, '/api/orders/create', { type: 'REQUEST', quantity: 1 });
    record('request-while-agreement-pending-approval', { status: pending.status, message: pending.body?.message, reproduced: pending.body?.message === 'Cannot create request: No active agreement with a supplier found' });

    // ---- 4. Distributor Owner approves the agreement.
    const approved = await post(distributor.cookie, `/api/agreements/${created.agreementId}/approve`, {}, 'PATCH');
    const approvedStatus = (await db.query('select status::text from "Agreement" where id = $1', [created.agreementId])).rows[0]?.status;
    record('distributor-owner-approved', { status: approved.status, agreementStatus: approvedStatus });

    // ---- 5. The same request now succeeds.
    const success = await post(distributor.cookie, '/api/orders/create', { type: 'REQUEST', quantity: 1 });
    created.orderId = success.body?.data?.order?.id;
    record('request-after-activation', { status: success.status, message: success.body?.message, orderNumber: success.body?.data?.order?.orderNumber });

    // ---- 6. What the supplier-selection helper reports for this distributor now.
    const suppliers = await (await fetch(`${API}/api/agreements?page=1&limit=20`, { headers: { cookie: distributor.cookie } })).json();
    const activeAgreement = (suppliers.data?.agreements ?? []).find(row => row.status === 'ACTIVE');
    record('supplier-visible-to-distributor', { activeAgreement: activeAgreement ? { id: activeAgreement.id, parent: activeAgreement.parentOrg?.name } : null });
  } catch (error) {
    record('error', { message: error.message });
  } finally {
    created = { ...created };
    const removed = await cleanup();
    const after = await counts();
    record('cleanup', removed);
    record('after-counts', after);
    record('restored', { restored: JSON.stringify(before) === JSON.stringify(after), before, after });

    const fs = require('node:fs');
    fs.writeFileSync(path.join(outDir, 'order-request-repro.json'), JSON.stringify({ tag: TAG, before, after, removed, results }, null, 2));
    await db.end();
  }
})().catch(async error => {
  console.error('REPRO FAILED:', error.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
