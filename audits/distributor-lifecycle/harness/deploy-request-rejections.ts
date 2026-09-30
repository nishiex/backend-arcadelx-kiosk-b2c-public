// Deploy only the independently reviewed additive rejection enums.
// --prepare: configured DB reads + local upgrade rehearsal.
// --apply <prepared evidence>: apply the exact SQL, then register only this migration.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const root = process.cwd(), api = path.join(root, 'apps/api');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const name = '20260930070000_request_rejections';
const file = path.join(api, 'prisma/migrations', name, 'migration.sql');
const migration = fs.readFileSync(file, 'utf8');
const checksum = crypto.createHash('sha256').update(migration).digest('hex');
assert.equal(checksum, '8ac7b3e1b927646a5c435af7112a45e24e397eb8cda54a4158bb74fb1f9fc0f2', 'Only reviewed enum SQL is allowed');
const mode = process.argv.includes('--prepare') ? 'prepare' : process.argv.includes('--apply') ? 'apply' : null;
assert.ok(mode, 'Use --prepare or --apply <prepared evidence>');
const stamp = new Date().toISOString().replace(/\D/g, '');
const out = path.join(root, 'audits/distributor-lifecycle', `request-rejection-deployment-${stamp}.json`);
const configured = process.env.DIRECT_URL!;
const targetHash = crypto.createHash('sha256').update(new URL(configured).host + new URL(configured).pathname).digest('hex');
const db = new pg.Client({ connectionString: configured, connectionTimeoutMillis: 10000, statement_timeout: 20000, application_name: `request_rejection_${mode}` });
const evidence: any = { mode, migration: name, checksum, targetHash, checkedAt: new Date().toISOString(), remoteDDLCommitted: false, prismaRecorded: false };
const save = () => fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
async function enums(client: pg.Client) {
  return (await client.query(`SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' AND t.typname IN ('AgreementStatus','NetworkStatus') GROUP BY t.typname ORDER BY 1`)).rows;
}
async function history(client: pg.Client) {
  return (await client.query(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`)).rows;
}
async function fingerprint(client: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const { tablename } of (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','RefreshToken','PasswordReset') ORDER BY tablename`)).rows) {
    result[tablename] = (await client.query(`SELECT count(*)::int count, md5(coalesce(string_agg(h,'' ORDER BY h),'')) digest FROM (SELECT md5(to_jsonb(t)::text) h FROM ${q(tablename)} t) s`)).rows[0];
  }
  return result;
}
function resolve(url: string) {
  // Supported Prisma registration of this applied SQL, never migrate deploy/reset.
  execFileSync(process.execPath, [path.join(api, 'node_modules/prisma/build/index.js'), 'migrate', 'resolve', '--applied', name], {
    cwd: api, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, TSX_TSCONFIG_PATH: path.join(api, 'tsconfig.json') },
    windowsHide: true, stdio: 'pipe', timeout: 60000,
  });
}
async function applyEnums(client: pg.Client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await client.query(`SET LOCAL lock_timeout='5s'`);
    const before = await fingerprint(client);
    await client.query(migration);
    const after = await fingerprint(client);
    assert.deepEqual(after, before, 'Every existing business row is preserved');
    return { before, after };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
try {
  await db.connect();
  if (mode === 'prepare') {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    evidence.enumsBefore = await enums(db);
    evidence.historyBefore = await history(db);
    assert.ok(evidence.historyBefore.every((r: any) => r.finished_at || r.rolled_back_at), 'Resolve failed migrations first');
    assert.ok(!evidence.historyBefore.some((r: any) => r.migration_name === name), 'Already registered; inspect before continuing');
    assert.deepEqual(evidence.enumsBefore, [
      { typname: 'AgreementStatus', labels: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'TERMINATED'] },
      { typname: 'NetworkStatus', labels: ['PENDING', 'ACTIVE'] },
    ]);
    evidence.enumColumns = (await db.query(`SELECT table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema='public' AND udt_name IN ('AgreementStatus','NetworkStatus') ORDER BY table_name,column_name`)).rows;
    assert.deepEqual(evidence.enumColumns, [{ table_name: 'Agreement', column_name: 'status', udt_name: 'AgreementStatus' }, { table_name: 'NetworkConnection', column_name: 'status', udt_name: 'NetworkStatus' }]);
    evidence.businessBefore = await fingerprint(db);
    await db.query('COMMIT'); save();

    const localUrl = new URL('postgresql://postgres@localhost:5433/arcadelx');
    localUrl.password = execFileSync('docker', ['exec', 'arcadelx-pg', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
    const admin = new pg.Client({ connectionString: localUrl.href }); await admin.connect();
    const database = `arcadelx_rejection_upgrade_${stamp}`;
    try { await admin.query(`CREATE DATABASE ${q(database)}`); } finally { await admin.end(); }
    localUrl.pathname = '/' + database;
    const local = new pg.Client({ connectionString: localUrl.href }); await local.connect();
    try {
      const dir = path.join(api, 'prisma/migrations');
      for (const entry of fs.readdirSync(dir).sort().filter(n => n < '20260929100000' || n === '20260929123000_distributor_access_status')) {
        const sqlFile = path.join(dir, entry, 'migration.sql'); if (fs.existsSync(sqlFile)) await local.query(fs.readFileSync(sqlFile, 'utf8'));
      }
      await local.query(`CREATE TABLE "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
      // Model the unresolved history names in the isolated rehearsal only.
      for (const row of evidence.historyBefore) await local.query(`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,rolled_back_at,applied_steps_count) VALUES ($1,$2,$3,$4,$5,1)`, [crypto.randomUUID(), row.checksum, row.migration_name, row.finished_at, row.rolled_back_at]);
      await local.query(`INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('upgrade-owner','upgrade@example.invalid','unusable','Local owner',now());
        INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES ('c','upgrade-owner','Company','COMPANY','State','City',400001,'Local fixture',now()),('d','upgrade-owner','Distributor','DISTRIBUTOR','State','City',400001,'Local fixture',now());
        INSERT INTO "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"updatedAt") VALUES ('n','c','d','PENDING',now());
        INSERT INTO "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct","effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","updatedAt") VALUES ('a','n','c','d',60,40,now(),'PENDING_APPROVAL',1000,200,now())`);
      evidence.localDataPreserved = await applyEnums(local); await local.query('COMMIT');
      resolve(localUrl.href);
      const registered = await history(local);
      assert.equal(registered.find(r => r.migration_name === name)?.checksum, checksum);
      assert.deepEqual(registered.filter(r => r.migration_name !== name), evidence.historyBefore);
      await local.query(`UPDATE "Agreement" SET status='REJECTED' WHERE id='a'; UPDATE "NetworkConnection" SET status='REJECTED' WHERE id='n'`);
      assert.equal((await local.query(`SELECT status FROM "Agreement" WHERE id='a'`)).rows[0].status, 'REJECTED');
      assert.equal((await local.query(`SELECT status FROM "NetworkConnection" WHERE id='n'`)).rows[0].status, 'REJECTED');
      assert.equal((await local.query(`SELECT to_regclass('public."OrderSequence"') AS t`)).rows[0].t, null, 'Order migration stays unapplied');
      evidence.localPrismaRegistrationPassed = true;
      evidence.localRejectionValuesStored = true;
      evidence.localDatabase = database;
      evidence.prepared = true;
    } finally { await local.end(); }
  } else {
    const preparedFile = process.argv[process.argv.indexOf('--apply') + 1]; assert.ok(preparedFile);
    const prepared = JSON.parse(fs.readFileSync(path.resolve(preparedFile), 'utf8'));
    assert.equal(prepared.prepared, true); assert.equal(prepared.checksum, checksum); assert.equal(prepared.targetHash, targetHash);
    assert.deepEqual(await enums(db), prepared.enumsBefore, 'Enum schema changed since review');
    assert.deepEqual(JSON.parse(JSON.stringify(await history(db))), prepared.historyBefore, 'Migration history changed since review');
    evidence.preparedEvidence = path.relative(root, path.resolve(preparedFile));
    evidence.dataPreservation = await applyEnums(db);
    evidence.historyBefore = await history(db);
    evidence.enumsBefore = prepared.enumsBefore;
    save();
    await db.query('COMMIT'); evidence.remoteDDLCommitted = true; save();
    resolve(configured);
    evidence.historyAfter = await history(db);
    const applied = evidence.historyAfter.find((r: any) => r.migration_name === name);
    assert.ok(applied?.finished_at && !applied.rolled_back_at); assert.equal(applied.checksum, checksum);
    assert.deepEqual(evidence.historyAfter.filter((r: any) => r.migration_name !== name), evidence.historyBefore, 'Historical entries are unchanged');
    evidence.prismaRecorded = true;
    evidence.enumsAfter = await enums(db);
    assert.ok(evidence.enumsAfter.every((r: any) => r.labels.includes('REJECTED')));
  }
} catch (error: any) {
  await db.query('ROLLBACK').catch(() => undefined);
  // Never print subprocess environment or a connection URL.
  evidence.error = { name: error.name, message: error.stdout || error.stderr ? 'Prisma registration failed; SQL commit state is recorded in this evidence.' : error.message };
  process.exitCode = 1;
} finally { await db.end(); save(); console.log(JSON.stringify({ out, prepared: evidence.prepared, remoteDDLCommitted: evidence.remoteDDLCommitted, prismaRecorded: evidence.prismaRecorded, error: evidence.error }, null, 2)); }
