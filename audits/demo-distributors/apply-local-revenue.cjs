// Local-only additive revenue migration with business-data preservation checks.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const u = new URL(env[key]);
  assert.ok(['localhost','127.0.0.1'].includes(u.hostname) && u.port === '5433' && u.pathname === '/arcadelx_local', 'Local database required');
}
const url = new URL(env.DIRECT_URL); url.hostname = '127.0.0.1';
const db = new Client({ connectionString:url.href,connectionTimeoutMillis:5000,statement_timeout:15000 });
const name = '20261005180000_integrate_revenue';
const dir = path.join(root,'apps/api/prisma/migrations');
const sql = fs.readFileSync(path.join(dir,name,'migration.sql'),'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');
const tables = ['User','Organization','Membership','NetworkConnection','Agreement','Kiosk','KioskAssignment','Order','OrderKiosk'];
async function fingerprints() {
  const result = {};
  for (const table of tables) result[table] = (await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(row,'' ORDER BY row),'')) AS digest FROM (SELECT to_jsonb(t)::text AS row FROM "${table}" t) x`)).rows[0];
  return result;
}
async function main() {
  try {
    await db.connect(); await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('local-revenue-migration'))");
    const appliedNames = (await db.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map(r=>r.migration_name);
    const pending = fs.readdirSync(dir).filter(n=>fs.existsSync(path.join(dir,n,'migration.sql')) && !appliedNames.includes(n));
    console.log('Pending local migrations:', JSON.stringify(pending));
    assert.ok(pending.every(n=>n===name), 'Other pending migrations need inspection');
    await db.query(`LOCK TABLE ${tables.map(t=>'"'+t+'"').join(',')} IN SHARE MODE`);
    const before = await fingerprints();
    if (pending.includes(name)) {
      await db.query(sql.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,''));
      await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),now(),1)',[crypto.randomUUID(),checksum,name]);
    }
    assert.deepEqual(await fingerprints(),before,'Existing business rows changed');
    const revenueTables = ['Transaction','RevenueStatement','SystemSettings','RevenueSyncRunLog'];
    for (const table of revenueTables) assert.ok((await db.query('SELECT to_regclass($1) AS name',['public."'+table+'"'])).rows[0].name,table+' missing');
    await db.query('COMMIT');
    const report={database:'localhost:5433/arcadelx_local',migration:name,applied:pending.includes(name),createdTables:revenueTables,existingBusinessDataPreserved:true,before,remoteChanged:false,jobsEnabled:false};
    fs.writeFileSync(path.join(__dirname,'revenue-deployment.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({migration:name,tables:revenueTables,existingBusinessDataPreserved:true,remoteChanged:false},null,2));
  } catch(e) {await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally {await db.end();}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
