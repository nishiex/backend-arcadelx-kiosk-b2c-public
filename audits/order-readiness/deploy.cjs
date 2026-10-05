// Explicit, additive online repair. Does not replay or rewrite old migrations.
// Applies this one migration and its new Prisma history row atomically.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dotenv = require('dotenv');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const name = '20261005120000_restore_order_workflow';
const sql = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations', name, 'migration.sql'), 'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');
const config = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const readinessSql = `SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Kiosk' AND column_name='reservedOrderId') AS "reservationColumn",
  to_regclass('public."OrderSequence"') IS NOT NULL AS "orderSequence",
  to_regclass('public."EmailDelivery"') IS NOT NULL AS "emailDelivery"`;
async function fingerprint(c) {
  const result = {};
  const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','OrderSequence','EmailDelivery') ORDER BY tablename")).rows;
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (await c.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(record, '' ORDER BY record), '')) AS digest
      FROM (SELECT (to_jsonb(t) - 'reservedOrderId')::text AS record FROM ${quoted} t) rows`)).rows[0];
  }
  return result;
}
async function main() {
  assert.ok(process.argv.includes('--apply-online'), 'Explicit --apply-online is required');
  const verification = JSON.parse(fs.readFileSync(path.join(__dirname, 'verification.json'), 'utf8'));
  assert.equal(verification.migrationName, name);
  assert.equal(verification.checksum, checksum, 'Local verification must match the exact migration');
  assert.equal(verification.results.length, 4);
  assert.ok(verification.results.every(result => result.pass));
  const direct = new Client({ connectionString: config.DIRECT_URL, connectionTimeoutMillis:10000, statement_timeout:60000 });
  const runtime = new Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis:10000, statement_timeout:15000 });
  let committed = false;
  const evidence = { migration: name, checksum, checkedAt: new Date().toISOString() };
  try {
    await direct.connect(); await runtime.connect();
    await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const runtimeHistory = (await runtime.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    const runtimeBefore = await fingerprint(runtime);
    await runtime.query('ROLLBACK');
    await direct.query('BEGIN');
    await direct.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    await direct.query('SELECT pg_advisory_xact_lock(518051200)');
    await direct.query('LOCK TABLE "Order", "OrderKiosk", "Kiosk", "KioskAssignment" IN SHARE ROW EXCLUSIVE MODE');
    const history = (await direct.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
    assert.deepEqual(history, runtimeHistory, 'Runtime and migration endpoints must target the same history');
    const before = await fingerprint(direct);
    assert.deepEqual(before, runtimeBefore, 'Runtime and direct endpoint data must agree; retry if concurrent changes occurred');
    assert.ok(!history.some(row => row.migration_name === name), 'Repair already recorded; inspect instead of reapplying');
    evidence.before = before;
    evidence.readinessBefore = (await direct.query(readinessSql)).rows[0];
    assert.ok(Object.values(evidence.readinessBefore).every(value => value === false), 'Expected reverted schema changed; inspect before applying');
    // The migration has explicit BEGIN/COMMIT for Prisma. Keep its body within
    // this encompassing transaction so schema changes and history cannot split.
    await direct.query(sql.replace(/^BEGIN;\r?\n/m, '').replace(/COMMIT;\s*$/, ''));
    const after = await fingerprint(direct);
    assert.deepEqual(after, before, 'Existing business rows must remain unchanged');
    evidence.readinessAfter = (await direct.query(readinessSql)).rows[0];
    assert.ok(Object.values(evidence.readinessAfter).every(Boolean));
    evidence.backfilledReservations = (await direct.query('SELECT count(*)::int count FROM "Kiosk" WHERE "reservedOrderId" IS NOT NULL')).rows[0].count;
    evidence.sequences = (await direct.query('SELECT year,value FROM "OrderSequence" ORDER BY year')).rows;
    await direct.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
      VALUES ($1,$2,$3,now(),now(),1)`, [crypto.randomUUID(), checksum, name]);
    await direct.query('COMMIT'); committed = true;
    evidence.committed = true;
    await runtime.query('BEGIN READ ONLY');
    evidence.runtimeReadiness = (await runtime.query(readinessSql)).rows[0];
    await runtime.query('ROLLBACK');
    assert.ok(Object.values(evidence.runtimeReadiness).every(Boolean));
    evidence.businessRowsPreserved = true;
    console.log(JSON.stringify({ migration:name, committed, readiness:evidence.runtimeReadiness, businessRowsPreserved:true, backfilledReservations:evidence.backfilledReservations }));
  } catch (error) {
    if (!committed) await direct.query('ROLLBACK').catch(() => {});
    evidence.committed = committed;
    evidence.error = error.code || error.message;
    throw error;
  } finally {
    await direct.end(); await runtime.end();
    fs.writeFileSync(path.join(__dirname, 'deployment.json'), JSON.stringify(evidence, null, 2));
  }
}
main().catch(error => { console.error('Order repair:', error.code || error.message); process.exitCode=1; });
