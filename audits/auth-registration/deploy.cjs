// Apply only the locally verified registration repair to the configured online DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),dotenv=require('dotenv'),{Client}=require('pg');
const root=path.resolve(__dirname,'../..');
const name='20261005121000_restore_registration_fields';
const sql=fs.readFileSync(path.join(root,'apps/api/prisma/migrations',name,'migration.sql'),'utf8');
const checksum=crypto.createHash('sha256').update(sql).digest('hex');
const fields=['gstNumber','phone','country','isActive','accessVersion'];
const fingerprintSql=`SELECT count(*)::int AS count, md5(coalesce(string_agg(row,'' ORDER BY row),'')) AS digest
  FROM (SELECT (to_jsonb(o)-ARRAY['gstNumber','phone','country','isActive','accessVersion'])::text AS row FROM "Organization" o) x`;
const historySql='SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name';
async function main(){
  assert.ok(process.argv.includes('--apply-online'),'Explicit --apply-online is required');
  const tested=JSON.parse(fs.readFileSync(path.join(__dirname,'verification.json')));
  assert.ok(tested.completed && tested.results.every(x=>x.pass));assert.equal(tested.checksum,checksum);
  const config=dotenv.parse(fs.readFileSync(path.join(root,'.env')));
  const direct=new Client({connectionString:config.DIRECT_URL,connectionTimeoutMillis:10000,statement_timeout:15000});
  const runtime=new Client({connectionString:config.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:15000});
  const evidence={migration:name,checksum,checkedAt:new Date().toISOString()};let committed=false;
  try{
    await direct.connect();await runtime.connect();
    await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const runtimeBefore=(await runtime.query(fingerprintSql)).rows[0];
    const runtimeHistory=(await runtime.query(historySql)).rows;
    await runtime.query('ROLLBACK');
    await direct.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await direct.query("SET LOCAL lock_timeout='5s'");
    await direct.query('SELECT pg_advisory_xact_lock(518051210)');
    await direct.query('LOCK TABLE "Organization" IN SHARE ROW EXCLUSIVE MODE');
    const history=(await direct.query(historySql)).rows;
    assert.deepEqual(history,runtimeHistory,'Runtime and migration history differ');
    assert.ok(!history.some(row=>row.migration_name===name),'Repair already applied; inspect instead of replaying');
    evidence.before=(await direct.query(fingerprintSql)).rows[0];
    assert.deepEqual(evidence.before,runtimeBefore,'Runtime/direct company data differ');
    const present=(await direct.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Organization' AND column_name=ANY($1::text[])",[fields])).rows;
    assert.equal(present.length,0,'Expected reverted schema changed; inspect before applying');
    await direct.query(sql.replace(/^BEGIN;\r?\n/m,'').replace(/COMMIT;\s*$/,''));
    evidence.after=(await direct.query(fingerprintSql)).rows[0];
    assert.deepEqual(evidence.after,evidence.before,'Existing Organization data must remain unchanged');
    evidence.restored=(await direct.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Organization' AND column_name=ANY($1::text[]) ORDER BY column_name",[fields])).rows.map(x=>x.column_name);
    assert.equal(evidence.restored.length,fields.length);
    const invalid=(await direct.query('SELECT count(*)::int n FROM "Organization" WHERE "isActive" IS DISTINCT FROM true OR "accessVersion" IS DISTINCT FROM 0')).rows[0].n;
    assert.equal(invalid,0,'Restored defaults must match previous access fallback');
    await direct.query('INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),now(),1)',[crypto.randomUUID(),checksum,name]);
    await direct.query('COMMIT');committed=true;
    const readable=(await runtime.query('SELECT count(*)::int n FROM "Organization" WHERE "isActive" AND "accessVersion"=0')).rows[0].n;
    assert.equal(readable,evidence.before.count);
    evidence.committed=true;evidence.existingDataPreserved=true;
    console.log(JSON.stringify({migration:name,committed,existingDataPreserved:true,restored:evidence.restored}));
  }catch(error){if(!committed)await direct.query('ROLLBACK').catch(()=>{});evidence.committed=committed;evidence.error=error.code||error.message;throw error;}
  finally{await direct.end();await runtime.end();fs.writeFileSync(path.join(__dirname,'deployment.json'),JSON.stringify(evidence,null,2));}
}
main().catch(error=>{console.error('Registration repair:',error.code||error.message);process.exitCode=1;});
