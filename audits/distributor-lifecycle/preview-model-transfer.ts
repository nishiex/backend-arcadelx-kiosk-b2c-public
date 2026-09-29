// Read-only candidate selection for a small running-app test assignment.
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const companyId = 'bbba8db6-0e6b-4482-8194-c5d3f7f9bf52';
const distributorId = '67abc491-0fec-4385-a8b9-ed95c4b94f08';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000, statement_timeout: 20000, application_name: 'model_transfer_preview_readonly' });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const organizations = (await client.query('SELECT id,name,type FROM "Organization" WHERE id=ANY($1::text[])', [[companyId, distributorId]])).rows;
  const inventory = (await client.query('SELECT "currentOrgId",model,status,count(*)::int AS count FROM "Kiosk" GROUP BY "currentOrgId",model,status ORDER BY model,status')).rows;
  const candidates = (await client.query(`SELECT DISTINCT ON (k.model) k.id,k."machineCode",k.model,k.status,k."currentOrgId",k."createdAt" FROM "Kiosk" k
    WHERE k."currentOrgId"=$1 AND k.status='AVAILABLE' AND k."externalDeviceId" IS NULL
    AND NOT EXISTS(SELECT 1 FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId" WHERE ok."kioskId"=k.id AND o.status IN ('APPROVED','DISPATCHED'))
    AND NOT EXISTS(SELECT 1 FROM "KioskAssignment" a WHERE a."kioskId"=k.id AND a."assignedTo" IS NULL AND a."organizationId"<>$1)
    ORDER BY k.model,k."createdAt" DESC,k."machineCode" DESC LIMIT 3`, [companyId])).rows;
  const relations = (await client.query(`SELECT a.id AS "agreementId",a.status AS "agreementStatus",n.id AS "networkId",n.status AS "networkStatus" FROM "Agreement" a JOIN "NetworkConnection" n ON n.id=a."networkConnectionId" WHERE a."parentOrgId"=$1 AND a."childOrgId"=$2 AND n."initiatorOrgId"=$1 AND n."receiverOrgId"=$2`, [companyId, distributorId])).rows;
  const owner = (await client.query(`SELECT m."userId",m.role,m.status FROM "Membership" m JOIN "Organization" o ON o.id=m."organizationId" WHERE o.id=$1 AND m."userId"=o."ownerId" AND m.role='OWNER' AND m.status='ACTIVE'`, [companyId])).rows;
  await client.query('COMMIT');
  const result = { checkedAt: new Date().toISOString(), organizations, inventory, candidates, relations, companyOwner: owner, scope: 'Read-only configured database preview' };
  fs.writeFileSync(path.join(root, 'audits/distributor-lifecycle/model-transfer-preview.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await client.end(); }
