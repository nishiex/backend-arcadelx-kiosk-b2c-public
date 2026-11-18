/*
 * Remove IP/royalty data so the IP demo can be seeded again.
 *
 * Safe by default: this is a dry run. A real delete requires:
 *   node scripts/clear-ip-royalties.cjs --confirm
 *
 * This intentionally preserves users, organizations, kiosks, transactions,
 * assignments, and non-IP distributor/partner allocations.
 */
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const destructive = process.argv.includes('--confirm');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const tables = [
  'IpGameKiosk',
  'IpSettlementLine',
  'IpSettlement',
  'IpDailyGameKiosk',
  'IpDailyGameRevenue',
  'IpDailyPartySummary',
  'IpDailyRevenueJobRun',
  'IpGame',
  'IpAgreement',
  'IpProfile',
];

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(742080002)');

    const { rows: ipOrganizations } = await client.query(`
      SELECT id, "ownerId" FROM "Organization" WHERE type = 'IP_PARTY'
    `);
    const ipOrganizationIds = ipOrganizations.map((row) => row.id);
    const ipOwnerIds = [...new Set(ipOrganizations.map((row) => row.ownerId))];

    const counts = {};
    for (const table of tables) {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
      counts[table] = rows[0].count;
    }
    const splitCount = await client.query(`
      SELECT count(*)::int AS count
      FROM "TransactionSplit"
      WHERE "isIpTransaction" = true
         OR "ipOrganizationId" IS NOT NULL
         OR "ipGameId" IS NOT NULL
         OR "ipAgreementId" IS NOT NULL
         OR "ipSharePct" IS NOT NULL
         OR "ipShare" IS NOT NULL
         OR "companyRetainedShare" IS NOT NULL
    `);
    counts.TransactionSplitIpFields = splitCount.rows[0].count;
    counts.IpPartyOrganizations = ipOrganizationIds.length;
    counts.IpPartyOwners = ipOwnerIds.length;

    console.table(counts);

    if (!destructive) {
      await client.query('ROLLBACK');
      console.log('Dry run only. Nothing was changed. Re-run with --confirm to delete these records.');
      return;
    }

    // Preserve each TransactionSplit row because it may also contain
    // distributor/partner allocation data; clear only its IP allocation.
    await client.query(`
      UPDATE "TransactionSplit"
      SET "isIpTransaction" = false,
          "ipOrganizationId" = NULL,
          "ipGameId" = NULL,
          "ipAgreementId" = NULL,
          "ipSharePct" = NULL,
          "ipShare" = NULL,
          "companyRetainedShare" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "isIpTransaction" = true
         OR "ipOrganizationId" IS NOT NULL
         OR "ipGameId" IS NOT NULL
         OR "ipAgreementId" IS NOT NULL
         OR "ipSharePct" IS NOT NULL
         OR "ipShare" IS NOT NULL
         OR "companyRetainedShare" IS NOT NULL
    `);

    for (const table of tables) {
      await client.query(`DELETE FROM "${table}"`);
    }

    if (ipOrganizationIds.length > 0) {
      // These relations are intentionally explicit because their schema
      // relations do not all cascade from Organization.
      await client.query(`DELETE FROM "EmailDelivery" WHERE "ownerOrganizationId" = ANY($1::text[])`, [ipOrganizationIds]);
      await client.query(`DELETE FROM "Membership" WHERE "organizationId" = ANY($1::text[])`, [ipOrganizationIds]);
      await client.query(`DELETE FROM "Organization" WHERE id = ANY($1::text[])`, [ipOrganizationIds]);
    }

    // Remove only orphaned owners created for those IP parties. If an owner
    // also owns another organization, retain the account.
    if (ipOwnerIds.length > 0) {
      await client.query(`
        DELETE FROM "User" u
        WHERE u.id = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."ownerId" = u.id)
          AND NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u.id)
      `, [ipOwnerIds]);
    }

    await client.query('COMMIT');
    console.log('IP, royalty, IP-party organization, and orphaned IP-owner data deleted. Company data, kiosks, transactions, and non-IP splits were preserved.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('IP/royalty cleanup failed:', error.message);
  process.exitCode = 1;
});
