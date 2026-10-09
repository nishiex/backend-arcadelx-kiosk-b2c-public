// Reduce the local database to just the company login, then leave it ready for the
// device/payment re-sync.
//
// Kept (the account you sign in with):
//   - the COMPANY organization, its owner User, that owner's Membership
//   - that owner's RefreshToken rows, so an existing session keeps working
//   - _prisma_migrations, which is migration history rather than data
//
// Removed: every other organization (distributors, partners), user, membership and
// refresh token, plus all business data -- agreements, network connections, kiosks,
// assignments, transactions, orders, email deliveries, sync logs, password resets --
// and both sequences are reset to 0.
//
// Deletion order follows the foreign keys: dependants before the rows they point at,
// and organizations before their owner users (Organization.ownerId references User).
//
// Local database only. No application code is changed.
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
const evidencePath = path.join(__dirname, 'database-cleared.json');

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "Organization")::int as organizations,
    (select count(*) from "User")::int as users,
    (select count(*) from "Membership")::int as memberships,
    (select count(*) from "RefreshToken")::int as refresh_tokens,
    (select count(*) from "Kiosk")::int as kiosks,
    (select count(*) from "KioskAssignment")::int as assignments,
    (select count(*) from "Transaction")::int as transactions,
    (select count(*) from "Order")::int as orders,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "NetworkConnection")::int as connections,
    (select count(*) from "EmailDelivery")::int as deliveries,
    (select count(*) from "RevenueSyncRunLog")::int as sync_logs`);
  return rows[0];
}

(async () => {
  await db.connect();
  const evidence = { startedAt: new Date().toISOString(), database: `${target.hostname}:${target.port}${target.pathname}` };
  try {
    evidence.before = await counts();
    console.log('BEFORE', JSON.stringify(evidence.before));

    const company = (await db.query(
      `select id, name, "ownerId" from "Organization" where type = 'COMPANY' order by "createdAt" asc limit 1`)).rows[0];
    if (!company) throw new Error('No COMPANY organization found; refusing to wipe (nothing to keep).');
    const owner = (await db.query('select id, email from "User" where id = $1', [company.ownerId])).rows[0];
    if (!owner) throw new Error('The COMPANY has no owner user; refusing to wipe.');
    evidence.kept = { companyId: company.id, companyName: company.name, ownerId: owner.id, ownerEmail: owner.email };
    console.log('KEEPING', JSON.stringify(evidence.kept));

    await db.query('begin');
    // Sessions and memberships of everyone else.
    const refreshTokens = await db.query('delete from "RefreshToken" where "userId" <> $1 returning id', [owner.id]);
    const memberships = await db.query('delete from "Membership" where "userId" <> $1 returning id', [owner.id]);
    // Relationship business data (references the organizations being removed).
    const agreements = await db.query('delete from "Agreement" returning id');
    const connections = await db.query('delete from "NetworkConnection" returning id');
    // Fleet and its ledger.
    const orderKiosks = await db.query('delete from "OrderKiosk" returning "kioskId"');
    const orders = await db.query('delete from "Order" returning id');
    const assignments = await db.query('delete from "KioskAssignment" returning id');
    const transactions = await db.query('delete from "Transaction" returning id');
    const kiosks = await db.query('delete from "Kiosk" returning id');
    // Operational records that only concern the removed accounts or the removed fleet.
    const deliveries = await db.query('delete from "EmailDelivery" returning id');
    const syncLogs = await db.query('delete from "RevenueSyncRunLog" returning id');
    const passwordResets = await db.query('delete from "PasswordReset" where "userId" <> $1 returning id', [owner.id]);
    // Organizations before their owner users.
    const organizations = await db.query('delete from "Organization" where id <> $1 returning id', [company.id]);
    const users = await db.query('delete from "User" where id <> $1 returning id', [owner.id]);
    // Fresh numbering for the upcoming sync and any future order.
    await db.query('update "MachineSequence" set value = 0');
    await db.query('update "OrderSequence" set value = 0');
    await db.query('commit');

    evidence.removed = {
      refreshTokens: refreshTokens.rowCount,
      memberships: memberships.rowCount,
      agreements: agreements.rowCount,
      connections: connections.rowCount,
      orderKiosks: orderKiosks.rowCount,
      orders: orders.rowCount,
      assignments: assignments.rowCount,
      transactions: transactions.rowCount,
      kiosks: kiosks.rowCount,
      deliveries: deliveries.rowCount,
      syncLogs: syncLogs.rowCount,
      passwordResets: passwordResets.rowCount,
      organizations: organizations.rowCount,
      users: users.rowCount,
    };
    console.log('REMOVED', JSON.stringify(evidence.removed));

    evidence.after = await counts();
    console.log('AFTER', JSON.stringify(evidence.after));

    const survivors = (await db.query(`select
      (select count(*) from "Organization" where type = 'COMPANY')::int as companies,
      (select count(*) from "Membership" where "userId" = $1 and role = 'OWNER' and status = 'ACTIVE')::int as owner_membership`, [owner.id])).rows[0];
    evidence.survivors = survivors;
    const membershipStillWorks = (await db.query(
      'select count(*)::int as n from "Membership" where "userId" = $1 and "organizationId" = $2', [owner.id, company.id])).rows[0].n === 1;
    console.log('SURVIVORS', JSON.stringify({ ...survivors, membershipStillWorks }));

    evidence.passed = evidence.after.organizations === 1 && evidence.after.users === 1 &&
      evidence.after.kiosks === 0 && evidence.after.transactions === 0 && membershipStillWorks;
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
