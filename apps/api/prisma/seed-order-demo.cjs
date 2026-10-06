// Local-only, additive order demonstration. Run from the repository root.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../../..');
const envPath = path.join(root, '.env');
const env = dotenv.parse(fs.readFileSync(envPath));
const target = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error('This seed only supports local arcadelx_local on port 5433');
}
const email = 'order-demo-distributor@example.invalid';
const client = new Client({ connectionString: env.DATABASE_URL });
async function insert(table, data) {
  const fields = Object.keys(data);
  return (await client.query(
    `INSERT INTO "${table}" (${fields.map(key => `"${key}"`).join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function main() {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('arcadelx-local-order-demo'))");
    const companies = (await client.query(`SELECT id,"ownerId" FROM "Organization" WHERE type='COMPANY'`)).rows;
    if (companies.length !== 1) throw new Error('Expected one existing Company');
    const company = companies[0];
    if ((await client.query('SELECT id FROM "User" WHERE email=$1', [email])).rowCount) {
      console.log('Order demo account already exists; no existing data changed.');
      await client.query('ROLLBACK');
      return;
    }
    const password = env.DEMO_DISTRIBUTOR_PASSWORD || randomBytes(24).toString('base64url');
    if (!env.DEMO_DISTRIBUTOR_PASSWORD) {
      fs.appendFileSync(envPath, `\n# Local order demo login\nDEMO_DISTRIBUTOR_EMAIL=${email}\nDEMO_DISTRIBUTOR_PASSWORD=${password}\n`);
    }
    const now = new Date();
    const owner = await insert('User', { id: randomUUID(), email, passwordHash: await bcrypt.hash(password, 12), name: 'Demo Distributor Owner', updatedAt: now });
    const distributor = await insert('Organization', {
      id: randomUUID(), ownerId: owner.id, name: 'Demo Pune Distributor', type: 'DISTRIBUTOR',
      state: 'Maharashtra', city: 'Pune', pincode: 411001, address: 'Demo Business Park, Sample Road', country: 'India', updatedAt: now,
    });
    await insert('Membership', { id: randomUUID(), userId: owner.id, organizationId: distributor.id, role: 'OWNER', status: 'ACTIVE', updatedAt: now });
    const connection = await insert('NetworkConnection', { id: randomUUID(), initiatorOrgId: company.id, receiverOrgId: distributor.id, status: 'ACTIVE', updatedAt: now });
    const agreement = await insert('Agreement', {
      id: randomUUID(), networkConnectionId: connection.id, parentOrgId: company.id, childOrgId: distributor.id,
      parentSharePct: 40, childSharePct: 60, effectiveFrom: now, status: 'ACTIVE',
      depositAmountPerMachine: 10000, nonRefundableAmountPerMachine: 2000, updatedAt: now,
    });
    const models = ['ADLX-Pro-X1', 'Arcade-LX B2C', 'Arcade-LX Healthcare'];
    for (let index = 1; index <= 12; index++) {
      const kiosk = await insert('Kiosk', { id: randomUUID(), machineCode: `DEMO-LOCAL-${String(index).padStart(3, '0')}`, model: models[(index - 1) % models.length], status: 'AVAILABLE', currentOrgId: company.id, updatedAt: now });
      await insert('KioskAssignment', { id: randomUUID(), kioskId: kiosk.id, organizationId: company.id, assignedById: company.ownerId });
    }
    const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now));
    const sequence = (await client.query('INSERT INTO "OrderSequence" (year,value) VALUES ($1,1) ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value', [year])).rows[0].value;
    const order = await insert('Order', {
      id: randomUUID(), orderNumber: `ORD-${year}-${String(sequence).padStart(5, '0')}`, type: 'REQUEST', status: 'UNDER_REVIEW', paymentStatus: 'PENDING',
      parentOrgId: company.id, childOrgId: distributor.id, agreementId: agreement.id, quantity: 3,
      depositPerMachine: 10000, nonRefundablePerMachine: 2000, totalDeposit: 30000, totalNonRefundable: 6000, taxAmount: 1080, grandTotal: 37080, updatedAt: now,
    });
    await client.query('COMMIT');
    console.log(JSON.stringify({ distributor: distributor.name, availableCompanyKiosks: 12, activeAgreements: 1, orderNumber: order.orderNumber, quantity: order.quantity, status: order.status, total: order.grandTotal, login: 'DEMO_DISTRIBUTOR_EMAIL / DEMO_DISTRIBUTOR_PASSWORD in ignored root .env' }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
