const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const u = new URL(dotenv.parse(fs.readFileSync(path.join(root, '.env'))).DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.pathname !== '/arcadelx_local') throw Error('Local required');
u.hostname = '127.0.0.1';
const c = new Client({ connectionString: u.href, connectionTimeoutMillis: 5000, query_timeout: 5000 });
async function main() {
  try {
    await c.connect();
    await c.query('BEGIN READ ONLY');
    const contactColumn = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='contact'")).rowCount > 0;
    const partners = (await c.query('SELECT o.id,o.name,m.role,m.status FROM "Organization" o LEFT JOIN "Membership" m ON m."organizationId"=o.id WHERE o.type=\'PARTNER\'')).rows;
    const result = { database: 'arcadelx_local', contactColumn, partners, readOnly: true };
    await c.query('COMMIT');
    fs.writeFileSync(path.join(__dirname, 'partner-schema.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await c.end(); }
}
main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
