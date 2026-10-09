// Read-only inspection of any Postgres target, addressed by the TARGET_DATABASE_URL
// environment variable so no credential is ever stored in this file.
import path from 'node:path';
import { createRequire } from 'node:module';

const root = 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c';
const require_ = createRequire(path.join(root, 'apps/api/package.json'));
const { Client } = require_('pg');

const connectionString = process.env.TARGET_DATABASE_URL;
if (!connectionString) throw new Error('set TARGET_DATABASE_URL');

const url = new URL(connectionString);
console.log(`TARGET ${url.hostname}:${url.port}${url.pathname} (user ${url.username})`);

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

try {
  await client.connect();
  console.log('CONNECT ok');

  const tables = (await client.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by table_name`)).rows.map(r => r.table_name);
  console.log(`TABLES ${tables.length}: ${tables.join(', ') || '(none)'}`);

  if (tables.includes('_prisma_migrations')) {
    const migrations = (await client.query(
      'select migration_name from _prisma_migrations where finished_at is not null order by migration_name')).rows;
    console.log(`MIGRATIONS ${migrations.length}`);
    for (const row of migrations) console.log('  ' + row.migration_name);
  }

  let total = 0;
  for (const table of tables) {
    if (table === '_prisma_migrations') continue;
    const count = (await client.query(`select count(*)::int as n from "${table}"`)).rows[0].n;
    total += count;
    if (count > 0) console.log(`  DATA ${table}: ${count} rows`);
  }
  console.log(`TOTAL APPLICATION ROWS: ${total}`);
  console.log(total === 0 ? 'VERDICT: empty' : 'VERDICT: holds data');
} catch (error) {
  console.log('ERROR ' + error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
