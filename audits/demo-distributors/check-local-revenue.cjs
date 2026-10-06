// Read-only local revenue/schema and authenticated GET checks. No imports or jobs started.
const fs = require('node:fs'), path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
const u = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== '5433' || u.pathname !== '/arcadelx_local') throw Error('Local target required');
u.hostname = '127.0.0.1';
const db = new Client({ connectionString:u.href, connectionTimeoutMillis:5000, query_timeout:5000 });
async function main() {
  const report = { database:'arcadelx_local', jobsEnabled:env.REVENUE_JOBS_ENABLED === 'true', redisConfigured:!!env.REDIS_URL, sourceConfigured:!!env.MOTHERSHIP_TRANSACTION_API_URL, tables:{}, http:[] };
  try {
    await db.connect(); await db.query('BEGIN READ ONLY');
    for (const table of ['Transaction','RevenueStatement','SystemSettings','RevenueSyncRunLog','Kiosk','KioskAssignment']) {
      const exists = (await db.query('SELECT to_regclass($1) AS name', ['public."'+table+'"'])).rows[0].name !== null;
      report.tables[table] = { exists, ...(exists ? {rows:Number((await db.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n)} : {}) };
    }
    report.migrationRecorded = (await db.query('SELECT id FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL', ['20261005180000_integrate_revenue'])).rowCount > 0;
    await db.query('ROLLBACK');
  } finally { await db.end(); }
  const saved = dotenv.parse(fs.readFileSync(path.join(root,'.env.local-backup-20261005')));
  const demo = dotenv.parse(fs.readFileSync(path.join(root,'.env.demo-distributors.local')));
  const candidates = [
    { label:'Company seed',email:env.SEED_OWNER_EMAIL || saved.SEED_OWNER_EMAIL,password:env.SEED_OWNER_PASSWORD || saved.SEED_OWNER_PASSWORD },
    { label:'Pune Distributor',email:demo.PUNE_EMAIL,password:demo.PUNE_PASSWORD },
    { label:'Mumbai Distributor',email:demo.MUMBAI_EMAIL,password:demo.MUMBAI_PASSWORD },
  ];
  for (const actor of candidates) {
    if (!actor.email || !actor.password) continue;
    const login = await fetch('http://localhost:3000/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password}),signal:AbortSignal.timeout(5000)});
    report.http.push({actor:actor.label,path:'/api/auth/login',status:login.status});
    if (!login.ok) continue;
    const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    try {
      for (const endpoint of ['/api/revenue/machine-wise','/api/revenue/deduction-rates']) {
        const response=await fetch('http://localhost:3000'+endpoint,{headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)});
        const data=await response.json();
        report.http.push({actor:actor.label,path:endpoint,status:response.status,message:data.message,...(data.data?.kiosks?{machines:data.data.kiosks.length}:{}),...(data.data?.settings?{settings:data.data.settings}:{})});
      }
    } finally { await fetch('http://localhost:3000/api/auth/refresh/logout',{method:'POST',headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)}); }
    break;
  }
  console.log(JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(__dirname,'local-revenue-check.json'),JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1});
