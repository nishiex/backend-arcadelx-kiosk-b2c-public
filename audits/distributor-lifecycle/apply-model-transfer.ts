// Explicit execution of the requested three-model TEST inventory assignment.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignTestModels, type TestAssignmentPlan } from './test-model-assignment';

assert(process.argv.includes('--apply-test-assignment'), 'Explicit execution flag required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const preview = JSON.parse(fs.readFileSync(path.join(root, 'audits/distributor-lifecycle/model-transfer-preview.json'), 'utf8'));
const plan: TestAssignmentPlan = {
  companyId: 'bbba8db6-0e6b-4482-8194-c5d3f7f9bf52',
  distributorId: '67abc491-0fec-4385-a8b9-ed95c4b94f08',
  distributorName: 'Test Distributor Pvt Ltf',
  actingUserId: preview.companyOwner[0].userId,
  agreementId: preview.relations[0].agreementId,
  networkId: preview.relations[0].networkId,
  kiosks: preview.candidates.map(({ id, machineCode, model }: any) => ({ id, machineCode, model })),
};
assert.equal(plan.kiosks.length, 3);
const outputDir = path.join(root, 'audits/distributor-lifecycle/running-model-transfer');
assert(!fs.existsSync(path.join(outputDir, 'result.json')), 'A completed transfer is already recorded; verify it instead of rerunning');
fs.mkdirSync(outputDir, { recursive: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000, statement_timeout: 20000, application_name: 'requested_test_inventory_assignment' });
try {
  await client.connect();
  const result = await assignTestModels(client, plan, snapshot => fs.writeFileSync(path.join(outputDir, 'before.json'), JSON.stringify(snapshot, null, 2)));
  const proof = { committedAt: new Date().toISOString(), operation: 'TEST_INVENTORY_ASSIGNMENT', database: 'Configured running-app database', plan, ...result };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  const inventory = (await client.query(`SELECT o.name,k.model,count(*)::int AS count FROM "Kiosk" k JOIN "Organization" o ON o.id=k."currentOrgId" WHERE o.id=ANY($1::text[]) GROUP BY o.name,k.model ORDER BY o.name,k.model`, [[plan.companyId, plan.distributorId]])).rows;
  console.log(JSON.stringify({ inventory }));
} finally { await client.end(); }
