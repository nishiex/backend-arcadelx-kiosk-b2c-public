// New local databases only. No Docker API, child processes, online writes or email.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const dotenv = require('dotenv');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const migrationName = '20261005120000_restore_order_workflow';
const migrationDir = path.join(root, 'apps/api/prisma/migrations');
const repair = fs.readFileSync(path.join(migrationDir, migrationName, 'migration.sql'), 'utf8');
const local = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const url = new URL(local.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5433');
const stamp = new Date().toISOString().replace(/\D/g, '');
const fixtureSource = fs.readFileSync(path.join(root, 'audits/distributor-lifecycle/harness/migration-upgrade.ts'), 'utf8');
const fixture = fixtureSource.match(/const fixture = `([\s\S]*?)`;/)[1];
const results = [];
const readySql = `SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId')
  AND to_regclass('public."OrderSequence"') IS NOT NULL
  AND to_regclass('public."EmailDelivery"') IS NOT NULL AS ready`;

async function fingerprint(client) {
  const result = {};
  for (const table of ['User', 'Organization', 'Membership', 'Order', 'OrderKiosk', 'Kiosk', 'KioskAssignment', 'Agreement', 'NetworkConnection']) {
    result[table] = (await client.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(record, '' ORDER BY record), '')) AS digest
      FROM (SELECT (to_jsonb(t) - 'reservedOrderId')::text AS record FROM "${table}" t) rows`)).rows[0];
  }
  return result;
}

async function main() {
  const admin = new Client({ connectionString: url.href });
  await admin.connect();
  try {
    for (const mode of ['reverted', 'already_current', 'bad_quantity', 'orphan_stock']) {
      const database = `arcadelx_order_repair_${stamp}_${mode}`;
      await admin.query(`CREATE DATABASE "${database}"`);
      const testUrl = new URL(url.href); testUrl.pathname = '/' + database;
      const c = new Client({ connectionString: testUrl.href });
      await c.connect();
      try {
        for (const name of fs.readdirSync(migrationDir).sort()) {
          if (name >= migrationName) continue;
          const file = path.join(migrationDir, name, 'migration.sql');
          if (!fs.existsSync(file)) continue;
          if (name === '20260929100000_protect_distributor_lifecycle') await c.query(fixture);
          await c.query(fs.readFileSync(file, 'utf8'));
        }
        if (mode !== 'already_current') {
          await c.query(`ALTER TABLE "Kiosk" DROP CONSTRAINT "Kiosk_reservedOrderId_fkey", DROP CONSTRAINT "kiosk_reservation_state", DROP COLUMN "reservedOrderId";
            DROP TABLE "OrderSequence"; DROP TABLE "EmailDelivery"; DROP INDEX "KioskAssignment_one_open_key";`);
        } else {
          await c.query('UPDATE "OrderSequence" SET value=100 WHERE year=2026');
        }
        if (mode === 'bad_quantity') await c.query(`UPDATE "Order" SET quantity=2 WHERE id='o'`);
        if (mode === 'orphan_stock') await c.query(`UPDATE "Kiosk" SET status='RESERVED' WHERE id='old-k'`);
        const before = await fingerprint(c);
        const valid = mode === 'reverted' || mode === 'already_current';
        let code = null;
        try { await c.query(repair); } catch (e) { code = e.code; await c.query('ROLLBACK'); }
        assert.equal(code, valid ? null : mode === 'bad_quantity' ? 'P0001' : '23514');
        assert.deepEqual(await fingerprint(c), before, 'business rows preserved');
        assert.equal((await c.query(readySql)).rows[0].ready, valid, 'failed repair rolls schema changes back');
        if (valid) {
          assert.equal((await c.query(`SELECT "reservedOrderId" FROM "Kiosk" WHERE id='k'`)).rows[0].reservedOrderId, 'o');
          const expectedNext = mode === 'already_current' ? 101 : 43;
          const next = (await c.query(`INSERT INTO "OrderSequence" (year,value) VALUES (2026,1)
            ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value`)).rows[0].value;
          assert.equal(next, expectedNext, 'counter retains existing numbers and higher values');
          await c.query(repair);
          assert.equal((await c.query('SELECT value FROM "OrderSequence" WHERE year=2026')).rows[0].value, next, 'repeat never lowers counter');
          await c.query(`BEGIN;
            INSERT INTO "Order" (id,"orderNumber",type,status,"parentOrgId","childOrgId","agreementId",quantity,"depositPerMachine","nonRefundablePerMachine","totalDeposit","totalNonRefundable","taxAmount","grandTotal","updatedAt")
            VALUES ('new-request','ORD-2026-${String(next).padStart(5, '0')}','REQUEST','UNDER_REVIEW','c','d','a',1,1000,200,1000,200,36,1236,now());
            UPDATE "Order" SET status='REJECTED' WHERE id='new-request';
            INSERT INTO "EmailDelivery" (id,key,kind,"ownerOrganizationId",payload,"updatedAt") VALUES ('test','test','INVOICE','c','test-fixture',now());
            ROLLBACK;`);
          assert.deepEqual(await fingerprint(c), before);
        }
        results.push({ mode, database, pass: true, ready: valid, expectedError: code });
        console.log(mode, 'PASS');
      } finally { await c.end(); }
    }
  } finally { await admin.end(); }
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), migrationName, checksum: crypto.createHash('sha256').update(repair).digest('hex'), results }, null, 2));
}
main().catch(error => { console.error('Verification failed:', error.code || error.message); process.exitCode = 1; });
