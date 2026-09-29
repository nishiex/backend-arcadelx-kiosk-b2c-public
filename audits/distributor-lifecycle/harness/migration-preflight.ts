// Read-only counts. Never applies migrations or changes business records.
// Explicit opt-in required because the root environment currently targets Supabase.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
if(!process.argv.includes('--configured-readonly')) throw new Error('Pass --configured-readonly to inspect the configured database without writes');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
dotenv.config({path:path.join(root,'.env'),quiet:true});
const client=new pg.Client({connectionString:process.env.DIRECT_URL,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'distributor_fix_preflight_readonly'});
const checks:Record<string,string>={
  duplicateNetworkPairs:`SELECT LEAST("initiatorOrgId","receiverOrgId"),GREATEST("initiatorOrgId","receiverOrgId") FROM "NetworkConnection" GROUP BY 1,2 HAVING count(*)>1`,
  selfNetworks:`SELECT 1 FROM "NetworkConnection" WHERE "initiatorOrgId"="receiverOrgId"`,
  selfAgreements:`SELECT 1 FROM "Agreement" WHERE "parentOrgId"="childOrgId"`,
  duplicateOpenAgreementPairs:`SELECT "parentOrgId","childOrgId" FROM "Agreement" WHERE status IN ('ACTIVE','PENDING_APPROVAL') GROUP BY 1,2 HAVING count(*)>1`,
  competingDistributorAgreements:`SELECT a."childOrgId" FROM "Agreement" a JOIN "Organization" p ON p.id=a."parentOrgId" WHERE a.status IN ('ACTIVE','PENDING_APPROVAL') AND p.type='DISTRIBUTOR' GROUP BY 1 HAVING count(*)>1`,
  duplicateOpenAssignments:`SELECT "kioskId" FROM "KioskAssignment" WHERE "assignedTo" IS NULL GROUP BY 1 HAVING count(*)>1`,
  ambiguousReservations:`SELECT ok."kioskId" FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId" WHERE o.status IN ('APPROVED','DISPATCHED') GROUP BY 1 HAVING count(*)>1`,
  mismatchedReservedStock:`SELECT 1 FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId" JOIN "Kiosk" k ON k.id=ok."kioskId" WHERE o.status IN ('APPROVED','DISPATCHED') AND (k."currentOrgId" IS DISTINCT FROM o."parentOrgId" OR (o.status='APPROVED' AND k.status<>'RESERVED') OR (o.status='DISPATCHED' AND k.status<>'ASSIGNED'))`,
  orphanReservedStock:`SELECT 1 FROM "Kiosk" k WHERE k.status IN ('RESERVED','ASSIGNED') AND NOT EXISTS (SELECT 1 FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId" WHERE ok."kioskId"=k.id AND o.status IN ('APPROVED','DISPATCHED'))`,
  incorrectActiveOrderQuantity:`SELECT o.id FROM "Order" o LEFT JOIN "OrderKiosk" ok ON ok."orderId"=o.id WHERE o.status IN ('APPROVED','DISPATCHED') GROUP BY o.id HAVING count(ok."kioskId")<>o.quantity OR o.quantity<1`,
  invalidAgreementRelationships:`SELECT 1 FROM "Agreement" a JOIN "NetworkConnection" n ON n.id=a."networkConnectionId" JOIN "Organization" p ON p.id=a."parentOrgId" JOIN "Organization" c ON c.id=a."childOrgId" WHERE n."initiatorOrgId"<>a."parentOrgId" OR n."receiverOrgId"<>a."childOrgId" OR NOT ((p.type='COMPANY' AND c.type IN ('DISTRIBUTOR','PARTNER')) OR (p.type='DISTRIBUTOR' AND c.type='PARTNER'))`,
  mismatchedAssignmentOwners:`SELECT 1 FROM "KioskAssignment" h JOIN "Kiosk" k ON k.id=h."kioskId" WHERE h."assignedTo" IS NULL AND h."organizationId" IS DISTINCT FROM k."currentOrgId"`,
};
const result:any={checkedAt:new Date().toISOString(),readOnly:true,counts:{}};
try {
  await client.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const [name,query] of Object.entries(checks)) result.counts[name]=Number((await client.query(`SELECT count(*) AS count FROM (${query}) conflicts`)).rows[0].count);
  const local=new Set(fs.readdirSync(path.join(root,'apps/api/prisma/migrations')));
  const applied=(await client.query('SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  result.extraConfiguredMigrations=applied.filter(row=>!local.has(row.migration_name)).map(row=>row.migration_name);
  result.failedMigrationNames=applied.filter(row=>!row.finished_at&&!row.rolled_back_at).map(row=>row.migration_name);
  result.fixMigrationApplied=applied.some(row=>row.migration_name==='20260929100000_protect_distributor_lifecycle'&&row.finished_at&&!row.rolled_back_at);
  await client.query('COMMIT');
} catch(error:any) {result.error={code:error.code||error.name}; process.exitCode=1;}
finally {
  await client.end();
  const out=path.join(root,'audits/distributor-lifecycle',`preflight-${result.checkedAt.replace(/\D/g,'')}.json`);
  fs.writeFileSync(out,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2)); console.log(out);
}
