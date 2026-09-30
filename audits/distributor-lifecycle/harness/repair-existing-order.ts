// A single, user-selected repair. --prepare reads Supabase and tests locally;
// --apply <prepared evidence> commits only the reviewed order status transition.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const id = 'afd69339-3d50-4fb5-b176-cd0322b1ae79';
const number = 'ORD-2026-721401-59';
const mode = process.argv.includes('--prepare') ? 'prepare' : process.argv.includes('--apply') ? 'apply' : null;
assert.ok(mode, 'Use --prepare or --apply <prepared evidence>');
const stamp = new Date().toISOString().replace(/\D/g, '');
const output = path.join(root, 'audits/distributor-lifecycle', `order-repair-${stamp}.json`);
const remote = new pg.Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 10000, statement_timeout: 20000, application_name: `reviewed_order_repair_${mode}` });
const evidence: any = { checkedAt: new Date().toISOString(), mode, orderId: id, intendedStatus: 'UNDER_REVIEW', remoteCommitted: false };
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
async function readOrder(db: pg.Client) {
  return (await db.query('SELECT to_jsonb(o) AS row FROM "Order" o WHERE id=$1', [id])).rows[0]?.row;
}
async function assertEligible(db: pg.Client) {
  const row = await readOrder(db);
  assert.ok(row, 'Target exists');
  assert.equal(row.orderNumber, number); assert.equal(row.type, 'REQUEST');
  assert.equal(row.status, 'APPROVED'); assert.equal(row.paymentStatus, 'PENDING');
  assert.equal(row.quantity, 20);
  for (const table of ['OrderKiosk', 'KioskAssignment']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${quote(table)} WHERE "orderId"=$1`, [id])).rows[0].n, 0, 'No order inventory history');
  }
  const reservedColumn = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId'`)).rowCount;
  if (reservedColumn) assert.equal((await db.query('SELECT count(*)::int AS n FROM "Kiosk" WHERE "reservedOrderId"=$1', [id])).rows[0].n, 0, 'No reservations');
  return row;
}
async function fingerprints(db: pg.Client) {
  const result: Record<string, unknown> = {};
  // Exclude only the reviewed order. Every other business row must remain equal.
  for (const table of ['Order', 'OrderKiosk', 'KioskAssignment', 'Kiosk', 'Agreement', 'NetworkConnection', '_prisma_migrations']) {
    if (!(await db.query('SELECT to_regclass($1) AS t', [`public.${quote(table)}`])).rows[0].t) continue;
    result[table] = (await db.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) h FROM ${quote(table)} t ${table === 'Order' ? 'WHERE id<>$1' : ''}) rows`, table === 'Order' ? [id] : [])).rows[0];
  }
  return result;
}
async function repair(db: pg.Client, expected: any) {
  await db.query(`SET LOCAL lock_timeout='5s'`);
  await db.query(`LOCK TABLE "OrderKiosk", "KioskAssignment", "Kiosk" IN SHARE MODE`);
  await db.query('SELECT id FROM "Order" WHERE id=$1 FOR UPDATE', [id]);
  assert.deepEqual(await assertEligible(db), expected, 'Order still equals reviewed snapshot');
  const before = await fingerprints(db);
  const changed = await db.query(`UPDATE "Order" SET status='UNDER_REVIEW', "updatedAt"=CURRENT_TIMESTAMP WHERE id=$1 AND status='APPROVED' AND "paymentStatus"='PENDING' AND type='REQUEST' AND quantity=20 RETURNING id`, [id]);
  assert.equal(changed.rowCount, 1);
  const after = await readOrder(db);
  assert.deepEqual({ ...after, status: expected.status, updatedAt: expected.updatedAt }, expected, 'Only status and updatedAt may change');
  assert.deepEqual(await fingerprints(db), before, 'Inventory, history, other orders, agreements and migration history unchanged');
  return { before: expected, after, otherRowsUnchanged: true, fingerprints: before };
}
try {
  await remote.connect();
  if (mode === 'prepare') {
    await remote.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    evidence.before = await assertEligible(remote);
    evidence.orderReferencingConstraints = (await remote.query(`SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid='public."Order"'::regclass ORDER BY 1`)).rows;
    assert.ok(evidence.orderReferencingConstraints.every((c: any) => ['"OrderKiosk"', '"KioskAssignment"', '"Kiosk"'].includes(c.table_name)), 'Review any additional order relationships before repairing');
    evidence.targetDatabaseHash = crypto.createHash('sha256').update(new URL(process.env.DIRECT_URL!).host + new URL(process.env.DIRECT_URL!).pathname).digest('hex');
    evidence.migrations = (await remote.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    await remote.query('COMMIT');
    save();
    const localUrl = new URL('postgresql://postgres@localhost:5433/arcadelx');
    localUrl.password = execFileSync('docker', ['exec', 'arcadelx-pg', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
    const admin = new pg.Client({ connectionString: localUrl.href }); await admin.connect();
    const database = `arcadelx_order_repair_${stamp}`;
    try { await admin.query(`CREATE DATABASE ${quote(database)}`); } finally { await admin.end(); }
    localUrl.pathname = '/' + database;
    const local = new pg.Client({ connectionString: localUrl.href }); await local.connect();
    try {
      const migrationDir = path.join(root, 'apps/api/prisma/migrations');
      for (const name of fs.readdirSync(migrationDir).sort().filter(n => n < '20260929100000')) {
        const file = path.join(migrationDir, name, 'migration.sql');
        if (fs.existsSync(file)) await local.query(fs.readFileSync(file, 'utf8'));
      }
      const row = evidence.before;
      await local.query(`INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('repair-owner','repair@example.invalid','unusable','Local fixture',now())`);
      await local.query(`INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES
        ($1,'repair-owner','Supplier','COMPANY','State','City',1,'Fixture',now()),($2,'repair-owner','Recipient','DISTRIBUTOR','State','City',1,'Fixture',now())`, [row.parentOrgId, row.childOrgId]);
      await local.query(`INSERT INTO "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"updatedAt") VALUES ('repair-network',$1,$2,'ACTIVE',now())`, [row.parentOrgId, row.childOrgId]);
      await local.query(`INSERT INTO "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct","effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","updatedAt") VALUES ($1,'repair-network',$2,$3,60,40,now(),'ACTIVE',1000,200,now())`, [row.agreementId, row.parentOrgId, row.childOrgId]);
      await local.query('INSERT INTO "Order" SELECT * FROM json_populate_record(NULL::"Order", $1::json)', [JSON.stringify(row)]);
      await local.query('BEGIN');
      evidence.localRepair = await repair(local, await readOrder(local));
      await local.query('COMMIT');
      // A second attempt must refuse the already-processed state.
      await local.query('BEGIN');
      await assert.rejects(() => repair(local, row), { code: 'ERR_ASSERTION' });
      await local.query('ROLLBACK');
      evidence.repeatRefused = true;
      await local.query(fs.readFileSync(path.join(migrationDir, '20260929100000_protect_distributor_lifecycle/migration.sql'), 'utf8'));
      evidence.lifecycleMigrationPassedOnLocalFixture = true;
      evidence.localDatabase = database;
      evidence.prepared = true;
    } finally { await local.end(); }
  } else {
    const preparedPath = process.argv[process.argv.indexOf('--apply') + 1];
    assert.ok(preparedPath, 'Prepared evidence required');
    const prepared = JSON.parse(fs.readFileSync(path.resolve(preparedPath), 'utf8'));
    assert.equal(prepared.prepared, true); assert.equal(prepared.orderId, id);
    assert.equal(prepared.intendedStatus, 'UNDER_REVIEW');
    assert.equal(prepared.targetDatabaseHash, crypto.createHash('sha256').update(new URL(process.env.DIRECT_URL!).host + new URL(process.env.DIRECT_URL!).pathname).digest('hex'));
    evidence.preparedEvidence = path.relative(root, path.resolve(preparedPath));
    await remote.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    evidence.repair = await repair(remote, prepared.before);
    // Persist the exact before/after image before committing the authorized change.
    save();
    await remote.query('COMMIT'); evidence.remoteCommitted = true; save();
    evidence.verifiedAfterCommit = await readOrder(remote);
    assert.equal(evidence.verifiedAfterCommit.status, 'UNDER_REVIEW');
  }
} catch (error: any) {
  await remote.query('ROLLBACK').catch(() => undefined);
  evidence.error = { code: error.code ?? error.name, message: error.message };
  process.exitCode = 1;
} finally { await remote.end(); save(); console.log(JSON.stringify({ output, mode, prepared: evidence.prepared, remoteCommitted: evidence.remoteCommitted, error: evidence.error }, null, 2)); }
