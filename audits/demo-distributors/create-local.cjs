// Add two local demo organizations without changing remote configuration or sending email.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const local = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const target = new URL(local.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') throw Error('Local-only target guard failed');
const credentialsPath = path.join(root, '.env.demo-distributors.local');
const saved = fs.existsSync(credentialsPath) ? dotenv.parse(fs.readFileSync(credentialsPath)) : {};
const demos = [
  { key: 'PUNE', name: 'Demo Pune Distribution', owner: 'Demo Pune Owner', email: 'demo-pune-distributor@example.invalid', city: 'Pune', pincode: 411001, address: 'Demo premises, Sample Road, Pune' },
  { key: 'MUMBAI', name: 'Demo Mumbai Distribution', owner: 'Demo Mumbai Owner', email: 'demo-mumbai-distributor@example.invalid', city: 'Mumbai', pincode: 400001, address: 'Demo premises, Sample Road, Mumbai' },
];
const c = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });
async function main() {
  await c.connect();
  const created = [];
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('arcadelx-demo-distributors-20261006'))");
    const company = await c.query(`SELECT id FROM "Organization" WHERE type='COMPANY'`);
    if (company.rowCount !== 1) throw Error('Expected one existing local Company');
    for (const d of demos) {
      const existing = await c.query('SELECT u.id,u."passwordHash",o.id AS "organizationId",o.name,m.role,m.status FROM "User" u LEFT JOIN "Organization" o ON o."ownerId"=u.id LEFT JOIN "Membership" m ON m."userId"=u.id AND m."organizationId"=o.id WHERE u.email=$1', [d.email]);
      let password = saved[`${d.key}_PASSWORD`];
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (existing.rowCount !== 1 || row.name !== d.name || row.role !== 'OWNER' || row.status !== 'ACTIVE' || !password || !await bcrypt.compare(password, row.passwordHash)) throw Error('Existing demo identity needs review; no overwrite performed');
        created.push({ name: d.name, email: d.email, organizationId: row.organizationId, result: 'already exists' });
        continue;
      }
      password ||= crypto.randomBytes(18).toString('base64url');
      saved[`${d.key}_EMAIL`] = d.email;
      saved[`${d.key}_PASSWORD`] = password;
      const userId = crypto.randomUUID(), orgId = crypto.randomUUID();
      await c.query('INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,now())', [userId,d.email,d.owner,await bcrypt.hash(password,12)]);
      await c.query('INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,country,"updatedAt") VALUES ($1,$2,$3,\'DISTRIBUTOR\',\'Maharashtra\',$4,$5,$6,\'India\',now())', [orgId,userId,d.name,d.city,d.pincode,d.address]);
      await c.query('INSERT INTO "Membership" (id,"userId","organizationId",role,status,"updatedAt") VALUES ($1,$2,$3,\'OWNER\',\'ACTIVE\',now())', [crypto.randomUUID(),userId,orgId]);
      created.push({ name:d.name,email:d.email,organizationId:orgId,result:'created' });
    }
    fs.writeFileSync(credentialsPath, '# LOCAL DEMO ONLY — arcadelx_local on localhost:5433\n' + Object.entries(saved).map(([k,v])=>`${k}=${v}`).join('\n') + '\n', { mode:0o600 });
    for (const d of demos) {
      const row = (await c.query('SELECT u."passwordHash",m.role,m.status,o.type,o."isActive" FROM "User" u JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."organizationId" WHERE u.email=$1', [d.email])).rows[0];
      if (!row || row.type !== 'DISTRIBUTOR' || row.role !== 'OWNER' || row.status !== 'ACTIVE' || !row.isActive || !await bcrypt.compare(saved[`${d.key}_PASSWORD`], row.passwordHash)) throw Error('Demo verification failed');
    }
    await c.query('COMMIT');
    const report = { database:'localhost:5433/arcadelx_local', distributors:created, verified:'Active distributor organizations, owner memberships, matching password hashes', emailSent:false, schemaChanged:false, remoteChanged:false, credentialsFile:'.env.demo-distributors.local', notes:'Local fixture seed against existing schema; contact column is not installed locally. No networks, agreements, orders or kiosks created.' };
    fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { await c.end(); }
}
main().catch(e=>{console.error(e.code || e.message);process.exitCode=1});
