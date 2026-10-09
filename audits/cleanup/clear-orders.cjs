// Clear the order data for a clean test baseline.
//
// Removes every Order plus the deliverables that belong to it:
//   - EmailDelivery rows keyed on the order (e.g. `order:<id>:invoice`)
//   - the rendered invoice files on disk
//   - the Order rows themselves
/// and resets OrderSequence so the next order starts at ORD-<year>-00001.
//
// Kept: kiosks, their ownership assignments, imported transactions, agreements,
// network connections, organizations, users and memberships.
//
// `OrderKiosk.orderId` and `Kiosk.reservedOrderId` are RESTRICT, so any surviving link
// or reservation would block the delete; both are asserted empty before the transaction.
// `KioskAssignment.orderId` is SET NULL, so ownership history would survive an order
// delete -- asserted empty here so nothing is silently rewritten.
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

const INVOICES_DIR = path.resolve(process.env.INVOICES_DIR ?? path.join(root, 'apps/api/invoices'));
const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });
const evidencePath = path.join(__dirname, 'orders-cleared.json');

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Order")::int as orders,
    (select count(*) from "OrderKiosk")::int as order_kiosks,
    (select count(*) from "KioskAssignment")::int as assignments,
    (select count(*) from "Kiosk")::int as kiosks,
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "EmailDelivery")::int as deliveries,
    (select value from "OrderSequence" where year = extract(year from now())::int) as order_sequence`);
  return rows[0];
}

(async () => {
  await db.connect();
  const evidence = { startedAt: new Date().toISOString(), database: `${target.hostname}:${target.port}${target.pathname}` };
  try {
    evidence.before = await counts();
    console.log('BEFORE', JSON.stringify(evidence.before));

    const orders = (await db.query(
      'select id, "orderNumber", "invoiceFilename" from "Order" order by "orderNumber"')).rows;
    evidence.orders = orders;
    console.log('TARGET_ORDERS', JSON.stringify(orders.map(o => o.orderNumber)));

    // Guard: a surviving link or reservation would make the delete fail mid-transaction.
    const blockers = await db.query(`select
      (select count(*) from "OrderKiosk")::int as order_kiosks,
      (select count(*) from "Kiosk" where "reservedOrderId" is not null)::int as reserved,
      (select count(*) from "KioskAssignment" where "orderId" is not null)::int as order_assignments`);
    evidence.blockers = blockers.rows[0];
    if (Object.values(blockers.rows[0]).some(value => Number(value) !== 0)) {
      throw new Error(`Refusing to delete: dependents present ${JSON.stringify(blockers.rows[0])}`);
    }

    const orderIds = orders.map(o => o.id);

    await db.query('begin');
    // Deliverables first, then the orders. Emails are keyed by text, not an FK.
    const deliveries = orderIds.length
      ? await db.query(`delete from "EmailDelivery" where key like any($1::text[]) returning key`, [orderIds.map(id => `%${id}%`)])
      : { rowCount: 0, rows: [] };
    const deleted = await db.query('delete from "Order" returning "orderNumber"');
    const year = new Date().getUTCFullYear();
    const sequence = await db.query(
      `insert into "OrderSequence" (year, value) values ($1, 0)
       on conflict (year) do update set value = 0 returning year, value`, [year]);
    await db.query('commit');

    evidence.removed = {
      orders: deleted.rowCount,
      orderNumbers: deleted.rows.map(r => r.orderNumber),
      emailDeliveries: deliveries.rowCount,
      deliveryKeys: deliveries.rows.map(r => r.key),
      orderSequenceReset: sequence.rows[0],
    };
    console.log('REMOVED', JSON.stringify(evidence.removed));

    // The rendered invoice files are now orphaned.
    const removedFiles = [];
    for (const order of orders) {
      if (!order.invoiceFilename) continue;
      const file = path.resolve(INVOICES_DIR, order.invoiceFilename);
      if (!file.startsWith(INVOICES_DIR + path.sep)) continue;
      if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); removedFiles.push(order.invoiceFilename); }
    }
    evidence.removedInvoiceFiles = removedFiles;
    console.log('REMOVED_INVOICE_FILES', JSON.stringify(removedFiles));

    evidence.after = await counts();
    console.log('AFTER', JSON.stringify(evidence.after));

    evidence.keptIntact = {
      kiosks: evidence.after.kiosks === evidence.before.kiosks,
      assignments: evidence.after.assignments === evidence.before.assignments,
      transactions: evidence.after.transactions === evidence.before.transactions,
      agreements: evidence.after.agreements === evidence.before.agreements,
    };
    console.log('KEPT_INTACT', JSON.stringify(evidence.keptIntact));

    evidence.passed = evidence.after.orders === 0 && Object.values(evidence.keptIntact).every(Boolean);
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
