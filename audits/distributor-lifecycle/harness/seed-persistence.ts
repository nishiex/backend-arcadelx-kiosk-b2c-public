// Executes the real seed only against a NEW local PostgreSQL database.
// The configured database is accessed exclusively via read-only seed --check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const api = path.join(root, 'apps/api');
const seedFile = path.join(api, 'prisma/seed.ts');
const stamp = new Date().toISOString().replace(/\D/g, '');
const database = `arcadelx_seed_${stamp}`;
const evidence: any = { database, existingDatabasesMutated: false, checks: [] };
const record = (name: string) => { evidence.checks.push({ name, pass: true }); console.log(name, 'PASS'); };
const localUrl = new URL('postgresql://postgres@localhost:5433/arcadelx');
localUrl.password = execFileSync('docker', ['exec', 'arcadelx-pg', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
const source = new pg.Client({ connectionString: localUrl.href }); await source.connect();
await source.query(`CREATE DATABASE "${database}"`); await source.end();
localUrl.pathname = '/' + database;
const sql = new pg.Client({ connectionString: localUrl.href }); await sql.connect();
const password = crypto.randomBytes(20).toString('hex');
const seedEnv = {
  ...process.env, DATABASE_URL: localUrl.href, DIRECT_URL: localUrl.href,
  TSX_TSCONFIG_PATH: path.join(api, 'tsconfig.json'),
  SEED_OWNER_NAME: 'Persistence Owner', SEED_OWNER_EMAIL: ' OWNER@EXAMPLE.INVALID ',
  SEED_OWNER_PASSWORD: password, SEED_COMPANY_NAME: 'Persisted Company',
  SEED_COMPANY_STATE: 'Maharashtra', SEED_COMPANY_CITY: 'Mumbai',
  SEED_COMPANY_PINCODE: '400092', SEED_COMPANY_ADDRESS: 'Database persistence fixture address',
};
async function run(env: NodeJS.ProcessEnv, args: string[] = [], cwd = root, cli = false) {
  return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, cli ? [path.join(api, 'node_modules/prisma/build/index.js'), 'db', 'seed', ...args] : ['--import', 'tsx', seedFile, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
}
async function counts() { return (await sql.query(`SELECT (SELECT count(*)::int FROM "User") users, (SELECT count(*)::int FROM "Organization") companies, (SELECT count(*)::int FROM "Membership") members`)).rows[0]; }
try {
  const migrationDir = path.join(api, 'prisma/migrations');
  for (const name of fs.readdirSync(migrationDir).sort().filter(n => n < '20260929100000')) {
    const file = path.join(migrationDir, name, 'migration.sql');
    if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
  }
  const missing = await run({ ...seedEnv, SEED_OWNER_PASSWORD: '' });
  assert.equal(missing.code, 1); assert.match(missing.output, /SEED_OWNER_PASSWORD/);
  assert.deepEqual(await counts(), { users: 0, companies: 0, members: 0 }); record('missing-configuration-writes-nothing');

  const behind = await run(seedEnv);
  assert.equal(behind.code, 1); assert.match(behind.output, /access-status migration/);
  assert.deepEqual(await counts(), { users: 0, companies: 0, members: 0 }); record('missing-insert-schema-refused-before-writing');
  for (const name of fs.readdirSync(migrationDir).sort().filter(n => n >= '20260929100000')) {
    const file = path.join(migrationDir, name, 'migration.sql'); if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
  }

  await sql.query(`CREATE FUNCTION fail_seed_membership() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'local injected membership failure'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_seed_membership BEFORE INSERT ON "Membership" FOR EACH ROW EXECUTE FUNCTION fail_seed_membership()`);
  const failed = await run(seedEnv);
  assert.equal(failed.code, 1); assert.ok(!failed.output.includes(password));
  assert.deepEqual(await counts(), { users: 0, companies: 0, members: 0 }); record('membership-failure-rolls-back-owner-and-company');
  await sql.query('DROP TRIGGER fail_seed_membership ON "Membership"; DROP FUNCTION fail_seed_membership()');

  const concurrent = await Promise.all([run(seedEnv), run(seedEnv, [], api)]);
  for (const r of concurrent) { assert.equal(r.code, 0, r.output.slice(-2000)); assert.ok(!r.output.includes(password)); }
  assert.equal(concurrent.filter(r => r.output.includes('saved to the database')).length, 1);
  assert.deepEqual(await counts(), { users: 1, companies: 1, members: 1 }); record('concurrent-seeds-create-one-complete-company');
  const observer = new pg.Client({ connectionString: localUrl.href }); await observer.connect();
  const row = (await observer.query(`SELECT u.id, u.email, u."passwordHash", o.name, m.role,m.status,m."organizationId",o.id AS "companyId" FROM "User" u JOIN "Membership" m ON m."userId"=u.id JOIN "Organization" o ON o.id=m."organizationId"`)).rows[0];
  await observer.end();
  assert.equal(row.email, 'owner@example.invalid'); assert.equal(row.name, seedEnv.SEED_COMPANY_NAME);
  assert.equal(row.role, 'OWNER'); assert.equal(row.status, 'ACTIVE');
  assert.notEqual(row.passwordHash, password); assert.ok(await bcrypt.compare(password, row.passwordHash));
  record('separate-connection-sees-persisted-rows-and-hashed-password');
  for (const column of ['gstNumber', 'phone', 'country', 'isActive', 'accessVersion']) await sql.query(`ALTER TABLE "Organization" RENAME COLUMN "${column}" TO "audit_${column}"`);
  const legacyCheck = await run(seedEnv, ['--check']); assert.equal(legacyCheck.code, 0, legacyCheck.output);
  record('existing-company-check-works-without-unapplied-columns');
  for (const column of ['gstNumber', 'phone', 'country', 'isActive', 'accessVersion']) await sql.query(`ALTER TABLE "Organization" RENAME COLUMN "audit_${column}" TO "${column}"`);

  await sql.query(`UPDATE "Organization" SET name='Edited in database'`);
  const beforeRepeat = (await sql.query(`SELECT to_jsonb(o) AS row FROM "Organization" o`)).rows[0].row;
  const repeated = await run({ ...seedEnv, SEED_COMPANY_NAME: 'Must not overwrite', SEED_OWNER_PASSWORD: 'DifferentPassword123' }, [], api, true);
  assert.equal(repeated.code, 0, repeated.output);
  assert.deepEqual((await sql.query(`SELECT to_jsonb(o) AS row FROM "Organization" o`)).rows[0].row, beforeRepeat);
  assert.equal((await sql.query(`SELECT "passwordHash" FROM "User"`)).rows[0].passwordHash, row.passwordHash);
  assert.deepEqual(await counts(), { users: 1, companies: 1, members: 1 }); record('prisma-cli-rerun-preserves-edits-password-and-row-counts');

  const check = await run(seedEnv, ['--check']); assert.equal(check.code, 0, check.output); record('read-only-check-verifies-persisted-owner');
  await sql.query(`UPDATE "Membership" SET status='PENDING'`);
  const invalid = await run(seedEnv, ['--check']); assert.equal(invalid.code, 1); assert.match(invalid.output, /inconsistent/);
  assert.equal((await sql.query(`SELECT status FROM "Membership"`)).rows[0].status, 'PENDING'); record('check-refuses-inconsistent-owner-without-overwriting');
  await sql.query(`UPDATE "Membership" SET status='ACTIVE'`);
  assert.equal((await run(seedEnv, ['--check'])).code, 0); record('seed-check-also-works-on-current-schema');

  // Login using the real API against the freshly seeded local database.
  process.env.DATABASE_URL = localUrl.href; process.env.DIRECT_URL = localUrl.href;
  process.env.MAILJET_API_KEY = 'local-audit'; process.env.MAILJET_SECRET_KEY = 'local-audit';
  process.env.NODE_ENV = 'development';
  const { default: app } = await import(pathToFileURL(path.join(api, 'src/app.ts')).href);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: row.email, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const me = await fetch(`${url}/api/auth/me`, { headers: { cookie } }); assert.equal(me.status, 200);
    const body = await me.json() as any;
    assert.equal(body.data.user.membership.organization.name, 'Edited in database');
    assert.equal(body.data.user.membership.role, 'OWNER'); record('real-api-login-reads-updated-database-values');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    const { prisma } = await import(pathToFileURL(path.join(api, 'src/utils/db.ts')).href); await prisma.$disconnect();
  }
} catch (error: any) {
  evidence.error = { name: error.name, message: error.message }; process.exitCode = 1;
} finally {
  await sql.end();
  const file = path.join(root, 'audits/distributor-lifecycle', `seed-persistence-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ file, passed: evidence.checks.length, error: evidence.error }, null, 2));
}
