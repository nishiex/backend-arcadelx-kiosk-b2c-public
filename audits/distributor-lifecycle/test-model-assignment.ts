// One-off test-data operation, not the commercial order/delivery workflow.
// Uses only existing columns; never changes orders, payments, models or status.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export type TestAssignmentPlan = {
  companyId: string; distributorId: string; distributorName: string;
  actingUserId: string; agreementId: string; networkId: string;
  kiosks: { id: string; machineCode: string; model: string }[];
};

export async function assignTestModels(client: any, plan: TestAssignmentPlan, saveBefore: (snapshot: any) => void) {
  assert.equal(plan.kiosks.length, 3);
  assert.equal(new Set(plan.kiosks.map(row => row.id)).size, 3);
  assert.equal(new Set(plan.kiosks.map(row => row.model)).size, 3);
  const ids = plan.kiosks.map(row => row.id).sort();
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    const organizations = (await client.query('SELECT id,name,type FROM "Organization" WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [[plan.companyId, plan.distributorId]])).rows;
    assert(organizations.some((row: any) => row.id === plan.companyId && row.type === 'COMPANY'));
    assert(organizations.some((row: any) => row.id === plan.distributorId && row.type === 'DISTRIBUTOR' && row.name === plan.distributorName));
    const actor = (await client.query(`SELECT "userId" FROM "Membership" WHERE "userId"=$1 AND "organizationId"=$2 AND status='ACTIVE' AND role IN ('OWNER','ADMIN') FOR SHARE`, [plan.actingUserId, plan.companyId])).rows;
    assert.equal(actor.length, 1, 'Requires an active Company owner/admin');
    const relationship = (await client.query(`SELECT a.id FROM "Agreement" a JOIN "NetworkConnection" n ON n.id=a."networkConnectionId"
      WHERE a.id=$1 AND n.id=$2 AND a.status='ACTIVE' AND n.status='ACTIVE'
      AND a."parentOrgId"=$3 AND a."childOrgId"=$4 AND n."initiatorOrgId"=$3 AND n."receiverOrgId"=$4 FOR UPDATE OF a,n`, [plan.agreementId, plan.networkId, plan.companyId, plan.distributorId])).rows;
    assert.equal(relationship.length, 1, 'Active exact-party agreement and network required');
    const before = (await client.query('SELECT to_jsonb(k) AS row FROM "Kiosk" k WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [ids])).rows.map((record: any) => record.row);
    assert.equal(before.length, 3);
    for (const row of before) {
      const expected = plan.kiosks.find(kiosk => kiosk.id === row.id)!;
      assert.equal(row.machineCode, expected.machineCode);
      assert.equal(row.model, expected.model);
      assert.equal(row.currentOrgId, plan.companyId, 'Kiosk must still belong to Company');
      assert.equal(row.status, 'AVAILABLE', 'Only available test stock can move');
      assert.equal(row.externalDeviceId, null, 'Choose unpaired test stock');
      assert(row.reservedOrderId == null, 'Reserved stock cannot move');
    }
    const activeOrders = (await client.query(`SELECT o.id FROM "Order" o JOIN "OrderKiosk" ok ON ok."orderId"=o.id WHERE ok."kioskId"=ANY($1::text[]) AND o.status IN ('APPROVED','DISPATCHED') FOR SHARE OF o`, [ids])).rows;
    assert.equal(activeOrders.length, 0, 'Selected kiosks must not be linked to active orders');
    const historyBefore = (await client.query('SELECT * FROM "KioskAssignment" WHERE "kioskId"=ANY($1::text[]) ORDER BY id FOR UPDATE', [ids])).rows;
    const open = historyBefore.filter((row: any) => row.assignedTo === null);
    assert(open.every((row: any) => row.organizationId === plan.companyId));
    assert.equal(new Set(open.map((row: any) => row.kioskId)).size, open.length, 'Ambiguous open assignment history');
    const ordersBefore = (await client.query('SELECT to_jsonb(o) AS row FROM "Order" o ORDER BY id')).rows;
    const otherStock = async () => (await client.query(`SELECT md5(coalesce(string_agg(to_jsonb(k)::text,'' ORDER BY k.id),'')) AS digest FROM "Kiosk" k WHERE NOT (id=ANY($1::text[]))`, [ids])).rows[0].digest;
    const othersBefore = await otherStock();
    saveBefore({ plan, before, historyBefore, ordersBefore, othersBefore, scope: 'Direct test assignment; no order/payment transition' });
    await client.query('UPDATE "KioskAssignment" SET "assignedTo"=CURRENT_TIMESTAMP WHERE "kioskId"=ANY($1::text[]) AND "assignedTo" IS NULL', [ids]);
    const assignmentIds: string[] = [];
    for (const id of ids) {
      const assignmentId = randomUUID();
      await client.query(`INSERT INTO "KioskAssignment" (id,"kioskId","organizationId","orderId","assignedById","assignedFrom","assignedTo") VALUES ($1,$2,$3,NULL,$4,CURRENT_TIMESTAMP,NULL)`, [assignmentId, id, plan.distributorId, plan.actingUserId]);
      assignmentIds.push(assignmentId);
    }
    const updated = await client.query(`UPDATE "Kiosk" SET "currentOrgId"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=ANY($2::text[]) AND "currentOrgId"=$3 AND status='AVAILABLE' RETURNING id,"machineCode",model,"currentOrgId",status`, [plan.distributorId, ids, plan.companyId]);
    assert.equal(updated.rowCount, 3);
    const historyAfter = (await client.query('SELECT * FROM "KioskAssignment" WHERE "kioskId"=ANY($1::text[]) ORDER BY id', [ids])).rows;
    assert.equal(historyAfter.length, historyBefore.length + 3);
    const current = historyAfter.filter((row: any) => row.assignedTo === null);
    assert.equal(current.length, 3);
    assert.equal(new Set(current.map((row: any) => row.kioskId)).size, 3);
    assert(current.every((row: any) => row.organizationId === plan.distributorId && row.orderId === null));
    assert.deepEqual((await client.query('SELECT to_jsonb(o) AS row FROM "Order" o ORDER BY id')).rows, ordersBefore);
    assert.equal(await otherStock(), othersBefore, 'Other stock must remain unchanged');
    const result = { kiosks: updated.rows, assignmentIds, historyRowsBefore: historyBefore.length, historyRowsAfter: historyAfter.length, ordersUnchanged: true, otherStockUnchanged: true };
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
