// Clear the kiosk fleet (the Machines data) for a clean test baseline.
//
// Deleting a Kiosk is blocked by three RESTRICT foreign keys, so the dependent rows are
// removed first, in dependency order, inside one transaction:
//   OrderKiosk -> KioskAssignment -> Transaction -> Kiosk
//
// Kept, by explicit request:
//   - Orders and their invoice records (ORD-2026-00004 keeps its invoiceFilename/URL, so
//     that invoice now references machines that no longer exist).
//   - Agreements, network connections, organizations, users, memberships, audit rows.
//   - The 4 real payments imported from the payment feed are deletable here because the
//     sync is idempotent: re-running audits/revenue-trend/fetch-live-payments.ts restores
//     them from the public feed.
//
// Resets MachineSequence for the current year so the next Add Machine starts at A001
// against an empty fleet. OrderSequence is NOT touched, because the surviving orders'
// numbers must stay unique.
//
// Local database only.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error(`Local-only guard failed for ${target.host}${target.pathname}`);
}

const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });
const evidencePath = path.join(__dirname, 'fleet-cleared.json');

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Kiosk")::int as kiosks,
    (select count(*) from "KioskAssignment")::int as assignments,
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "OrderKiosk")::int as order_kiosks,
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Order" where "invoiceFilename" is not null)::int as invoiced_orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "Organization")::int as organizations`);
  return rows[0];
}

(async () => {
  await db.connect();
  const evidence = { startedAt: new Date().toISOString(), database: `${target.hostname}:${target.port}${target.pathname}` };
  try {
    evidence.before = await counts();
    console.log('BEFORE', JSON.stringify(evidence.before));

    // Record exactly what is removed, so the deletion is auditable.
    evidence.deletedKioskCodes = (await db.query('select "machineCode" from "Kiosk" order by "machineCode"')).rows.map(r => r.machineCode);
    evidence.realFeedTransactions = (await db.query(
      `select "externalTransactionId" from "Transaction" where "externalTransactionId" like 'ADLX\\_%'`)).rows.map(r => r.externalTransactionId);

    await db.query('begin');
    // Dependency order; each table's FK to Kiosk is RESTRICT.
    const orderKiosks = await db.query('delete from "OrderKiosk" returning "kioskId"');
    const assignments = await db.query('delete from "KioskAssignment" returning id');
    const transactions = await db.query('delete from "Transaction" returning id');
    // Release any reservation pointer before the kiosk row goes. The
    // kiosk_reservation_state check constraint ties status to reservedOrderId
    // ((status IN ('RESERVED','ASSIGNED')) = (reservedOrderId IS NOT NULL)), so both
    // must change in the same statement.
    await db.query(`update "Kiosk" set status = 'AVAILABLE', "reservedOrderId" = null where "reservedOrderId" is not null`);
    const kiosks = await db.query('delete from "Kiosk" returning "machineCode"');
    // Startup fleet numbering for the current year.
    const year = new Date().getUTCFullYear();
    const sequence = await db.query(
      `insert into "MachineSequence" (year, value) values ($1, 0)
       on conflict (year) do update set value = 0 returning year, value`, [year]);
    await db.query('commit');

    evidence.removed = {
      kiosks: kiosks.rowCount,
      assignments: assignments.rowCount,
      transactions: transactions.rowCount,
      orderKiosks: orderKiosks.rowCount,
    };
    evidence.machineSequence = sequence.rows[0];
    console.log('REMOVED', JSON.stringify(evidence.removed));
    console.log('MACHINE_SEQUENCE_RESET', JSON.stringify(sequence.rows[0]));

    evidence.after = await counts();
    console.log('AFTER', JSON.stringify(evidence.after));

    evidence.passed = evidence.after.kiosks === 0 && evidence.after.transactions === 0 &&
      evidence.after.assignments === 0 && evidence.after.orders === evidence.before.orders &&
      evidence.after.invoiced_orders === evidence.before.invoiced_orders;
    console.log('KEPT_INTACT', JSON.stringify({
      orders: evidence.after.orders === evidence.before.orders,
      invoicedOrders: evidence.after.invoiced_orders === evidence.before.invoiced_orders,
      agreements: evidence.after.agreements === evidence.before.agreements,
      organizations: evidence.after.organizations === evidence.before.organizations,
    }));
  } catch (error) {
    await db.query('rollback').catch(() => {});
    evidence.passed = false;
    evidence.error = error.message;
    console.error('FAILED:', error.message);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await db.end();
  }
  process.exit(evidence.passed ? 0 : 1);
})();
