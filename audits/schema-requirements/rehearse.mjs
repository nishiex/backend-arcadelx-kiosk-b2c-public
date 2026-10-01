// Synthetic fixtures only, in a NEW database on the documented local Docker server.
// Does not load .env, use Supabase, apply the full lifecycle migration, or run email code.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migrationDir = path.join(root, 'apps/api/prisma/migrations');
const target = '20260929100000_protect_distributor_lifecycle';
const source = fs.readFileSync(path.join(migrationDir, target, 'migration.sql'), 'utf8').replaceAll('\r\n', '\n');
const preview = fs.readFileSync(path.join(here, 'reservation-sequence.preview.sql'), 'utf8');
const readinessSource = fs.readFileSync(path.join(root, 'apps/api/src/services/workflow-readiness.ts'), 'utf8');
const readinessQuery = readinessSource.match(/SELECT[\s\S]*?AS "orderDecisions"/)?.[0];
assert.ok(readinessQuery, 'Use the existing, unchanged readiness query');
assert.ok(preview.includes(source.slice(source.indexOf('ALTER TABLE "Kiosk" ADD COLUMN "reservedOrderId"'), source.indexOf('CREATE TABLE "EmailDelivery"'))), 'Preview preserves the original reservation and sequence SQL');
assert.ok(!preview.includes('EmailDelivery'), 'Preview excludes the deferred schema');
const body = preview.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n/m, '');
const url = new URL('postgresql://postgres@localhost:5433/postgres');
url.password = execFileSync('docker', ['exec', 'arcadelx-pg', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
const database = `arcadelx_schema_review_${new Date().toISOString().replace(/\D/g, '')}`;
const admin = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000 });
const evidence = { database, syntheticDataOnly: true, supabaseChanged: false, cases: [] };
const fixture = `
INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('u','schema@example.invalid','unusable','Fixture',now());
INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES
 ('c','u','Company','COMPANY','State','City',400001,'Address',now()),
 ('d','u','Distributor','DISTRIBUTOR','State','City',400001,'Address',now());
INSERT INTO "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"updatedAt") VALUES ('n','c','d','ACTIVE',now());
INSERT INTO "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct","effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","updatedAt")
 VALUES ('a','n','c','d',60,40,now(),'ACTIVE',1000,200,now());
INSERT INTO "Order" (id,"orderNumber",type,status,"parentOrgId","childOrgId","agreementId",quantity,"depositPerMachine","nonRefundablePerMachine","totalDeposit","totalNonRefundable","taxAmount","grandTotal","invoiceUrl","updatedAt") VALUES
 ('approved','ORD-2026-00042','ALLOCATION','APPROVED','c','d','a',1,1000,200,1000,200,36,1236,'/orders/approved/invoice',now()),
 ('dispatched','ORD-2026-00041','ALLOCATION','DISPATCHED','c','d','a',1,1000,200,1000,200,36,1236,null,now()),
 ('delivered','ORD-2025-00099','ALLOCATION','DELIVERED','c','d','a',1,1000,200,1000,200,36,1236,null,now()),
 ('legacy','ORD-2026-721401-59','REQUEST','UNDER_REVIEW','c','d','a',20,1000,200,20000,4000,720,24720,null,now());
INSERT INTO "Kiosk" (id,"machineCode",model,status,"currentOrgId","updatedAt") VALUES
 ('reserved','REVIEW-1','Model','RESERVED','c',now()),
 ('assigned','REVIEW-2','Model','ASSIGNED','c',now()),
 ('available','REVIEW-3','Model','AVAILABLE','d',now());
INSERT INTO "OrderKiosk" ("orderId","kioskId") VALUES ('approved','reserved'),('dispatched','assigned'),('delivered','available');
INSERT INTO "KioskAssignment" (id,"kioskId","organizationId","assignedById") VALUES ('history','available','d','u');
`;
const cases = [
  { name: 'valid-reservations-and-yearly-counters', sql: '', code: null },
  { name: 'incomplete-active-order', sql: `UPDATE "Order" SET quantity=2 WHERE id='approved'`, code: 'P0001' },
  { name: 'ambiguous-active-reservation', sql: `UPDATE "Order" SET quantity=2 WHERE id='dispatched'; INSERT INTO "OrderKiosk" VALUES ('dispatched','reserved')`, code: 'P0001' },
  { name: 'wrong-owner', sql: `UPDATE "Kiosk" SET "currentOrgId"='d' WHERE id='reserved'`, code: 'P0001' },
  { name: 'wrong-stock-status', sql: `UPDATE "Kiosk" SET status='AVAILABLE' WHERE id='assigned'`, code: 'P0001' },
  { name: 'orphan-reservation', sql: `UPDATE "Kiosk" SET status='RESERVED' WHERE id='available'`, code: '23514' },
  { name: 'counter-overflow-refuses-migration', sql: `UPDATE "Order" SET "orderNumber"='ORD-2026-2147483648' WHERE id='legacy'`, code: '22003' },
  { name: 'legacy-only-numbering', sql: `UPDATE "Order" SET "orderNumber"='LEGACY-' || id`, code: null },
];
let db;
async function snapshot() {
  const result = {};
  for (const table of ['Organization', 'Order', 'OrderKiosk', 'Kiosk', 'KioskAssignment']) {
    result[table] = (await db.query(`SELECT to_jsonb(t) - 'reservedOrderId' AS row FROM "${table}" t ORDER BY (to_jsonb(t) - 'reservedOrderId')::text`)).rows;
  }
  return result;
}
async function rejectedWrite(sql, code) {
  await db.query('SAVEPOINT invalid_write');
  await assert.rejects(db.query(sql), error => error.code === code);
  await db.query('ROLLBACK TO SAVEPOINT invalid_write');
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  await db.connect();
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, database);
  for (const name of fs.readdirSync(migrationDir).sort().filter(name => name < target)) {
    const file = path.join(migrationDir, name, 'migration.sql');
    if (fs.existsSync(file)) {
      const sql = fs.readFileSync(file, 'utf8');
      assert.ok(!sql.includes('EmailDelivery'), 'Bootstrap must exclude deferred schema');
      await db.query(sql);
    }
  }
  await db.query(fixture);
  const baseline = await snapshot();
  for (const test of cases) {
    await db.query('BEGIN');
    if (test.sql) await db.query(test.sql);
    const before = await snapshot();
    let code = null;
    try { await db.query(body); } catch (error) { code = error.code; }
    assert.equal(code, test.code, test.name);
    if (!code) {
      assert.deepEqual(await snapshot(), before, 'Business rows, amounts, invoice references and history preserved');
      assert.deepEqual((await db.query('SELECT id,"reservedOrderId" FROM "Kiosk" ORDER BY id')).rows, [
        { id: 'assigned', reservedOrderId: 'dispatched' },
        { id: 'available', reservedOrderId: null },
        { id: 'reserved', reservedOrderId: 'approved' },
      ]);
      assert.deepEqual((await db.query('SELECT year,value FROM "OrderSequence" ORDER BY year')).rows, test.name === 'legacy-only-numbering' ? [] : [{ year: 2025, value: 99 }, { year: 2026, value: 42 }]);
      const next = `INSERT INTO "OrderSequence" (year,value) VALUES (2026,1) ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value`;
      assert.equal((await db.query(next)).rows[0].value, test.name === 'legacy-only-numbering' ? 1 : 43);
      assert.equal((await db.query(next)).rows[0].value, test.name === 'legacy-only-numbering' ? 2 : 44);
      await rejectedWrite(`UPDATE "Kiosk" SET "reservedOrderId"='missing' WHERE id='reserved'`, '23503');
      await rejectedWrite(`UPDATE "Kiosk" SET "reservedOrderId"=null WHERE id='reserved'`, '23514');
      await rejectedWrite(`UPDATE "Kiosk" SET "reservedOrderId"='approved' WHERE id='available'`, '23514');
      assert.equal((await db.query(`SELECT to_regclass('public."EmailDelivery"') AS table_name`)).rows[0].table_name, null);
      assert.equal((await db.query(readinessQuery)).rows[0].orderDecisions, false, 'Existing readiness still blocks orders with both non-email requirements present');
    }
    await db.query('ROLLBACK');
    assert.deepEqual(await snapshot(), baseline, 'Fixture changes and migration DDL roll back completely');
    assert.equal((await db.query(`SELECT to_regclass('public."OrderSequence"') AS table_name`)).rows[0].table_name, null);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId'`)).rows[0].count, 0);
    evidence.cases.push({ name: test.name, passed: true, expectedFailureCode: code });
    console.log('PASS', test.name);
  }
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
  await admin.end();
  fs.writeFileSync(path.join(here, 'local-rehearsal.json'), JSON.stringify(evidence, null, 2) + '\n');
}
