// Real Express HTTP regression on a new, isolated local database. No external email.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Client } = require('pg');
const bcrypt = require('bcryptjs'), dotenv = require('dotenv'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const baseEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const url = new URL(baseEnv.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/arcadelx_local') throw Error('Local target required');
url.hostname = '127.0.0.1';
const database = 'arcadelx_partner_orders_' + Date.now();
const checks = [], sessions = [];
let server, prisma, db;
function check(label, condition) { assert.ok(condition, label); checks.push(label); console.log('PASS', label); }
async function main() {
  const admin = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`); await admin.end();
  url.pathname = '/' + database;
  db = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 }); await db.connect();
  Object.assign(process.env, baseEnv, { DATABASE_URL: url.href, DIRECT_URL: url.href, NODE_ENV: 'test',
    ACCESS_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'), REFRESH_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'),
    INTERNAL_API_SECRET: crypto.randomBytes(32).toString('hex'), MAILJET_API_KEY: 'local-test', MAILJET_SECRET_KEY: 'local-test', REVENUE_JOBS_ENABLED: 'false' });
  require('node-mailjet').apiConnect = () => ({ post: () => ({ request: async () => { throw Error('Unexpected email attempt'); } }) });
  const dir = path.join(root, 'apps/api/prisma/migrations');
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'migration.sql');
    if (fs.existsSync(file)) await db.query(fs.readFileSync(file, 'utf8'));
  }
  ({ prisma } = await import(pathToFileURL(path.join(root, 'apps/api/src/utils/db.ts')).href));
  const { default: app } = await import(pathToFileURL(path.join(root, 'apps/api/src/app.ts')).href);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function http(actor, route, body, method = 'POST') {
    const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: actor.cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json(), cookie: r.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
  }
  const password = crypto.randomBytes(20).toString('hex'), passwordHash = await bcrypt.hash(password, 10);
  async function actor(type, role = 'OWNER', org, status = 'ACTIVE') {
    const user = await prisma.user.create({ data: { name: `${type} ${role}`, email: crypto.randomUUID() + '@example.invalid', passwordHash } });
    org ||= await prisma.organization.create({ data: { name: type + ' Test', type, ownerId: user.id, state: 'Maharashtra', city: 'Pune', pincode: 411001, address: 'Isolated regression address' } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role, status } });
    const login = await http(null, '/api/auth/login', { email: user.email, password });
    assert.equal(login.status, 200); const result = { org, cookie: login.cookie }; sessions.push(result); return result;
  }
  const company = await actor('COMPANY'), distributor = await actor('DISTRIBUTOR'), partner = await actor('PARTNER');
  async function relationship(parent, child) {
    const connection = await prisma.networkConnection.create({ data: { initiatorOrgId: parent.org.id, receiverOrgId: child.org.id, status: 'ACTIVE' } });
    const agreement = await prisma.agreement.create({ data: { parentOrgId: parent.org.id, childOrgId: child.org.id, networkConnectionId: connection.id, status: 'ACTIVE', effectiveFrom: new Date(), parentSharePct: 60, childSharePct: 40, depositAmountPerMachine: 10000, nonRefundableAmountPerMachine: 2000 } });
    return { connection, agreement };
  }
  await relationship(company, distributor);
  const downstream = await relationship(distributor, partner);
  const request = (target, quantity = 2, type = 'REQUEST') => ({ type, targetOrgId: target.org.id, quantity });
  async function expect(actor, body, status, label) { const r = await http(actor, '/api/orders/create', body); check(label, r.status === status); return r.body.data?.order; }
  await expect(distributor, request(company), 201, 'Distributor Owner requests Company');
  const distributorAdmin = await actor('DISTRIBUTOR', 'ADMIN', distributor.org);
  await expect(distributorAdmin, request(company), 201, 'Distributor Admin requests Company');
  const order = await expect(partner, request(distributor), 201, 'Partner Owner requests Distributor');
  check('Partner request direction, status and agreement amounts', order.parentOrgId === distributor.org.id && order.childOrgId === partner.org.id && order.status === 'UNDER_REVIEW' && order.paymentStatus === 'PENDING' && order.grandTotal === 24720);
  const partnerAdmin = await actor('PARTNER', 'ADMIN', partner.org);
  await expect(partnerAdmin, request(distributor), 201, 'Partner Admin requests Distributor');
  await expect(partner, request(distributor, 1, 'ALLOCATION'), 403, 'Partner cannot allocate');
  await expect(partnerAdmin, request(distributor, 1, 'ALLOCATION'), 403, 'Partner Admin cannot allocate');
  for (const type of ['DISTRIBUTOR', 'PARTNER']) for (const role of ['MANAGER', 'STAFF']) {
    const member = await actor(type, role, type === 'PARTNER' ? partner.org : distributor.org);
    await expect(member, request(type === 'PARTNER' ? distributor : company), 403, `${type} ${role} cannot request`);
  }
  const pending = await actor('PARTNER', 'OWNER', partner.org, 'PENDING');
  await expect(pending, request(distributor), 403, 'Pending Partner membership cannot request');
  const before = await prisma.order.count();
  await expect(partner, request(company), 403, 'Partner cannot request unrelated Company');
  await expect(partner, request(partner), 403, 'Partner cannot request itself');
  for (const quantity of [0, 51, 1.5]) await expect(partner, request(distributor, quantity), 400, `Invalid quantity ${quantity} rejected`);
  await prisma.networkConnection.update({ where: { id: downstream.connection.id }, data: { status: 'PENDING' } });
  await expect(partner, request(distributor), 400, 'Inactive network blocks Partner request');
  await prisma.networkConnection.update({ where: { id: downstream.connection.id }, data: { status: 'ACTIVE' } });
  await prisma.agreement.update({ where: { id: downstream.agreement.id }, data: { status: 'TERMINATED', effectiveTo: new Date() } });
  await expect(partner, request(distributor), 403, 'Inactive agreement blocks Partner request');
  check('Rejected requests create no orders', await prisma.order.count() === before);
  await relationship(company, partner);
  await expect(partner, request(company, 1), 201, 'Partner can request directly contracted Company');
  check('Requests do not reserve inventory or enqueue email', await prisma.orderKiosk.count() === 0 && await prisma.emailDelivery.count() === 0);
  const approval = await http(partner, `/api/orders/${order.id}/approve`, {}, 'PATCH');
  check('Partner cannot approve orders', approval.status === 403);
  check('Supplier can see Partner request', (await http(distributor, `/api/orders/${order.id}`, null, 'GET')).status === 200);
  const unrelated = await actor('PARTNER');
  check('Unrelated Partner cannot read request', (await http(unrelated, `/api/orders/${order.id}`, null, 'GET')).status === 404);
  for (const session of sessions) await http(session, '/api/auth/refresh/logout', {});
  fs.writeFileSync(path.join(__dirname, 'partner-order-regression.json'), JSON.stringify({ database, checks, emailSent: false, applicationDatabaseChanged: false }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (prisma) await prisma.$disconnect();
  if (db) await db.end();
});
