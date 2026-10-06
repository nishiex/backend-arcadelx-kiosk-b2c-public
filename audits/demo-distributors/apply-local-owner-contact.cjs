// Apply only the checked-in owner-contact migration to arcadelx_local.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const urls = ['DATABASE_URL', 'DIRECT_URL'].map(key => new URL(env[key]));
for (const u of urls) assert.ok(['localhost', '127.0.0.1'].includes(u.hostname) && u.port === '5433' && u.pathname === '/arcadelx_local', 'Only the configured local database may be repaired');
urls[1].hostname = '127.0.0.1';
const name = '20261005190000_add_owner_contact';
const source = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations', name, 'migration.sql'), 'utf8');
const checksum = crypto.createHash('sha256').update(source).digest('hex');
const db = new Client({ connectionString: urls[1].href, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const fingerprint = `SELECT count(*)::int AS count, md5(coalesce(string_agg(row,'' ORDER BY row),'')) AS digest FROM (SELECT (to_jsonb(u)-'contact')::text AS row FROM "User" u) x`;
async function main() {
  try {
    await db.connect();
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('local-owner-contact-migration'))");
    await db.query('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
    const before = (await db.query(fingerprint)).rows[0];
    const history = (await db.query('SELECT checksum FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', [name])).rows;
    const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='contact'");
    let applied = false;
    if (history.length) {
      assert.equal(columns.rowCount, 1, 'Recorded migration but missing contact column');
    } else {
      assert.equal(columns.rowCount, 0, 'Contact already exists without migration history; inspect before proceeding');
      await db.query(source.replace(/^BEGIN;\r?\n/m, '').replace(/COMMIT;\s*$/, ''));
      await db.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),now(),1)', [crypto.randomUUID(),checksum,name]);
      applied = true;
    }
    const after = (await db.query(fingerprint)).rows[0];
    assert.deepEqual(after, before, 'Existing users must be preserved');
    // Check actual insert support and leading-zero preservation; never retain fixture data.
    await db.query('SAVEPOINT contact_probe');
    const id = crypto.randomUUID();
    await db.query('INSERT INTO "User" (id,email,name,"passwordHash",contact,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id,id+'@example.invalid','Rollback contact probe','not-a-login','0123456789']);
    assert.equal((await db.query('SELECT contact FROM "User" WHERE id=$1',[id])).rows[0].contact,'0123456789');
    await db.query('ROLLBACK TO SAVEPOINT contact_probe');
    await db.query('COMMIT');
    const result = { database:'localhost:5433/arcadelx_local', migration:name, applied, existingUsersPreserved:true, existingUserCount:before.count, contactInsertVerified:true, probeRolledBack:true, remoteChanged:false, emailSent:false };
    fs.writeFileSync(path.join(__dirname,'owner-contact-deployment.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } catch(e) { await db.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { await db.end(); }
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1});
