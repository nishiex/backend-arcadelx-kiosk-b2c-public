/**
 * Read-only inspection of whichever database the API is currently configured to use.
 *
 * Loads the ignored root `.env` the same way the API does (dotenv), connects with
 * `DIRECT_URL` (falling back to `DATABASE_URL`), and runs everything inside a
 * `BEGIN READ ONLY` transaction, so it cannot modify the target even by accident.
 *
 * Purpose: the API's gateway routes are gated by session auth (COMPANY OWNER/ADMIN),
 * so exercising `POST /api/admin/gateways/reorder` end to end needs a usable account
 * in this database. This probe answers, without writing anything:
 *   - is the target reachable at all, and which host/database is it,
 *   - do the tables/columns this application needs exist,
 *   - are there any users/organizations, and is there an ACTIVE COMPANY OWNER to log in as.
 *
 * Usage: node audits/gateways/db-online-readonly-check.cjs
 * Output: audits/gateways/db-online-readonly-check.json (plus a console summary)
 */
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Client } = require('pg');

const OUT = path.resolve(__dirname, 'db-online-readonly-check.json');

function redact(url) {
  if (!url) return '(unset)';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}${u.search}`;
  } catch {
    return '(unparseable url)';
  }
}

const REQUIRED_TABLES = [
  'User',
  'Organization',
  'Membership',
  'Kiosk',
  'KioskAssignment',
  'MachineSequence',
  'OrderSequence',
  'EmailDelivery',
  'Order',
  'OrderKiosk',
  'Transaction',
  'RevenueStatement',
  'SystemSettings',
];

const REQUIRED_COLUMNS = [
  ['Organization', 'phone'],
  ['Organization', 'country'],
  ['Organization', 'isActive'],
  ['Organization', 'accessVersion'],
  ['Organization', 'inviteCode'],
  ['Organization', 'inviteCodeExpiresAt'],
  ['User', 'contact'],
];

(async () => {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const report = { generatedAt: new Date().toISOString(), target: redact(url), source: process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL' };
  console.log('target:', report.target);

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  await client.connect();
  try {
    await client.query('SET statement_timeout = 45000');
    await client.query('BEGIN READ ONLY');

    const identity = await client.query(
      'select current_database() as database, current_user as usr, version() as version',
    );
    report.identity = identity.rows[0];

    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    report.publicTables = tables.rows.map((r) => r.table_name);
    report.requiredTables = Object.fromEntries(
      REQUIRED_TABLES.map((t) => [t, report.publicTables.includes(t)]),
    );
    report.missingTables = REQUIRED_TABLES.filter((t) => !report.requiredTables[t]);

    const cols = await client.query(
      `select table_name, column_name, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (${REQUIRED_COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')})`,
      REQUIRED_COLUMNS.flat(),
    );
    const foundCols = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    report.requiredColumns = Object.fromEntries(
      REQUIRED_COLUMNS.map(([t, c]) => [`${t}.${c}`, cols.rows.find((r) => r.table_name === t && r.column_name === c) ?? null]),
    );
    report.missingColumns = REQUIRED_COLUMNS.filter(([t, c]) => !foundCols.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);

    // Row counts, only for tables that exist (a missing table cannot be counted).
    report.counts = {};
    for (const t of ['User', 'Organization', 'Membership', 'Kiosk', 'KioskAssignment', 'Order', 'OrderKiosk', 'Transaction']) {
      if (!report.publicTables.includes(t)) {
        report.counts[t] = 'TABLE ABSENT';
        continue;
      }
      const r = await client.query(`select count(*)::int as n from "${t}"`);
      report.counts[t] = r.rows[0].n;
    }

    // Which account could even be used for the COMPANY OWNER/ADMIN gate.
    if (report.publicTables.includes('Membership') && report.publicTables.includes('Organization')) {
      const owners = await client.query(
        `select u.email, u.name, o.name as organization, o.type, m.role, m.status
           from "Membership" m
           join "User" u on u.id = m."userId"
           join "Organization" o on o.id = m."organizationId"
          where m.status = 'ACTIVE' and m.role = 'OWNER'
          order by o.type, u.email`,
      );
      report.activeOwners = owners.rows;
    }

    // Migration history: tells us which lineage this database carries.
    if (report.publicTables.includes('_prisma_migrations')) {
      const mig = await client.query(
        `select migration_name, finished_at is not null as applied, rolled_back_at is not null as rolled_back
           from _prisma_migrations order by started_at`,
      );
      report.migrations = mig.rows;
      report.migrationCount = mig.rows.length;
    }

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('database:', report.identity.database, '| server:', report.identity.version.split(',')[0]);
  console.log('public tables:', report.publicTables.length);
  console.log('missing tables:', report.missingTables.length ? report.missingTables.join(', ') : 'none');
  console.log('missing columns:', report.missingColumns.length ? report.missingColumns.join(', ') : 'none');
  console.log('counts:', JSON.stringify(report.counts));
  console.log('migrations recorded:', report.migrationCount ?? 'n/a');
  console.log('active owners:', JSON.stringify(report.activeOwners ?? []));
  console.log('wrote', OUT);
})().catch((error) => {
  console.error('PROBE FAILED:', error.message);
  process.exit(1);
});
