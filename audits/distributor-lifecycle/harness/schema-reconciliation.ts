// Read-only inventory for reconciling deployment history and business blockers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
if (!process.argv.includes('--configured-readonly')) throw new Error('Read-only opt-in required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const db = new pg.Client({ connectionString: process.env.DIRECT_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const migrations = (await db.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  const local = fs.readdirSync(path.join(root, 'apps/api/prisma/migrations')).filter(name => fs.existsSync(path.join(root, 'apps/api/prisma/migrations', name, 'migration.sql'))).map(name => ({
    name, checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'apps/api/prisma/migrations', name, 'migration.sql'))).digest('hex'),
    lfChecksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'apps/api/prisma/migrations', name, 'migration.sql'), 'utf8').replaceAll('\r\n', '\n')).digest('hex'),
  }));
  const blockers = (await db.query(`SELECT o.id, o."orderNumber", o.status, o."paymentStatus", o.quantity,
    o."parentOrgId", o."childOrgId", o."createdAt", o."updatedAt", count(ok."kioskId")::int AS "linkedKiosks",
    (SELECT count(*)::int FROM "KioskAssignment" a WHERE a."orderId"=o.id) AS "assignments",
    (SELECT count(*)::int FROM "Kiosk" k WHERE k."currentOrgId"=o."parentOrgId" AND k.status='AVAILABLE') AS "supplierAvailableStock"
    FROM "Order" o LEFT JOIN "OrderKiosk" ok ON ok."orderId"=o.id
    WHERE o.status IN ('APPROVED','DISPATCHED') GROUP BY o.id HAVING count(ok."kioskId")<>o.quantity OR o.quantity<1`)).rows;
  const columns = (await db.query("SELECT table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2")).rows;
  const result = { readOnly: true, checkedAt: new Date().toISOString(), blockers, localMigrations: local.map(item => ({ ...item, applied: migrations.some(m => m.migration_name === item.name && m.finished_at && !m.rolled_back_at), checksumMatches: migrations.find(m => m.migration_name === item.name)?.checksum === item.checksum, lfChecksumMatches: migrations.find(m => m.migration_name === item.name)?.checksum === item.lfChecksum })), extraMigrations: migrations.filter(m => !local.some(item => item.name === m.migration_name)), columns };
  await db.query('COMMIT');
  const output = path.join(root, 'audits/distributor-lifecycle/schema-reconciliation.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, columns: undefined }, null, 2));
} finally { await db.end(); }
