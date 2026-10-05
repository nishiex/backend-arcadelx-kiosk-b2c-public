// Read-only online/runtime checks. Never output credentials or personal data.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Client } = require('pg'), dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
async function main() {
  const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  const db = new Client({connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000});
  const report = {checkedAt: new Date().toISOString(), noBusinessWrites: true, noEmailSent: true};
  try {
    await db.connect();
    const rows = (await db.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows;
    const dir = path.join(root, 'apps/api/prisma/migrations');
    const local = fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'migration.sql')));
    report.pendingLocalMigrations = local.filter(n => !rows.some(r => r.migration_name === n));
    report.remoteOnlyMigrations = rows.filter(r => !local.includes(r.migration_name)).map(r => r.migration_name);
    const name = '20261005121000_restore_registration_fields';
    report.repairChecksumMatches = rows.find(r => r.migration_name === name)?.checksum === crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name, 'migration.sql'))).digest('hex');
    report.http = [];
    for (const url of ['http://localhost:4000/health/db', 'http://localhost:3000/partners', 'http://localhost:3000/api/auth/me']) {
      const response = await fetch(url, {signal: AbortSignal.timeout(40000)});
      report.http.push({url, status: response.status});
    }
    const mail = await fetch('https://api.mailjet.com/v3/REST/sender', {
      headers: {Authorization: 'Basic ' + Buffer.from(env.MAILJET_API_KEY + ':' + env.MAILJET_SECRET_KEY).toString('base64')},
      signal: AbortSignal.timeout(20000)
    });
    report.mailjetAuthenticationStatus = mail.status;
    fs.writeFileSync(path.join(__dirname, 'running-verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await db.end(); }
}
main().catch(e => {console.error(e.code || e.name); process.exitCode = 1;});
