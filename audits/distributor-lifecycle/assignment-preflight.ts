// Read-only preflight for the user's request to assign all running-app kiosks.
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000, statement_timeout: 20000, application_name: 'requested_assignment_preflight_readonly' });
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const organizations = (await client.query(`SELECT id,name,type FROM "Organization" WHERE type IN ('COMPANY','DISTRIBUTOR') ORDER BY type,name`)).rows;
  const kiosks = (await client.query(`SELECT k."currentOrgId",o.name,o.type,k.status,count(*)::int AS count FROM "Kiosk" k LEFT JOIN "Organization" o ON o.id=k."currentOrgId" GROUP BY k."currentOrgId",o.name,o.type,k.status ORDER BY o.name,k.status`)).rows;
  const networks = (await client.query(`SELECT id,"initiatorOrgId","receiverOrgId",status FROM "NetworkConnection" ORDER BY id`)).rows;
  const agreements = (await client.query(`SELECT id,"parentOrgId","childOrgId","networkConnectionId",status,"parentSharePct","childSharePct","depositAmountPerMachine","nonRefundableAmountPerMachine","effectiveFrom","effectiveTo" FROM "Agreement" ORDER BY id`)).rows;
  const orders = (await client.query(`SELECT o.id,o."orderNumber",o.type,o.status,o."paymentStatus",o."parentOrgId",o."childOrgId",o."agreementId",o.quantity,o."grandTotal",count(ok."kioskId")::int AS "linkedKiosks" FROM "Order" o LEFT JOIN "OrderKiosk" ok ON ok."orderId"=o.id GROUP BY o.id ORDER BY o."createdAt"`)).rows;
  const assignmentCounts = (await client.query(`SELECT a."organizationId",o.name,count(*)::int AS "openAssignments" FROM "KioskAssignment" a JOIN "Organization" o ON o.id=a."organizationId" WHERE a."assignedTo" IS NULL GROUP BY a."organizationId",o.name`)).rows;
  const schema = (await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='Kiosk' AND column_name='reservedOrderId') OR (table_name='Organization' AND column_name IN ('gstNumber','phone','country')) OR table_name IN ('OrderSequence','EmailDelivery')) ORDER BY table_name,column_name`)).rows;
  await client.query('COMMIT');
  const result = { checkedAt: new Date().toISOString(), scope: 'Configured running-app database; read-only; no records changed', organizations, kiosks, networks, agreements, orders, assignmentCounts, lifecycleSchema: schema };
  const output = path.join(root, 'audits/distributor-lifecycle/requested-assignment-preflight.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await client.end(); }
