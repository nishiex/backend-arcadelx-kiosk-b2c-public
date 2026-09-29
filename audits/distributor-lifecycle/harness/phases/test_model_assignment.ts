import assert from 'node:assert/strict';
import { assignTestModels } from '../../test-model-assignment';

export async function run(c: any) {
  const company = await c.fixture('model-company', 'COMPANY');
  const distributor = await c.fixture('model-distributor', 'DISTRIBUTOR');
  const network = await c.connect('model-network', company, distributor);
  const agreement = await c.agreement('model-agreement', company, distributor, network);
  for (const model of ['ADLX-Pro-X1', 'Arcade-LX B2C', 'Arcade-LX Healthcare', 'Company spare']) {
    const response = await c.http(`model-stock-${model}`, company, 'POST', '/api/kiosks/batch', { model, count: 1 }, 201);
    assert.equal(response.status, 201);
  }
  const kiosks = await c.prisma.kiosk.findMany({ where: { model: { not: 'Company spare' } }, orderBy: { model: 'asc' } });
  const plan = { companyId: company.orgId, distributorId: distributor.orgId, distributorName: 'model-distributor', actingUserId: company.userId, agreementId: agreement.id, networkId: network.id, kiosks };
  await c.prisma.kioskAssignment.createMany({ data: kiosks.map((row: any) => ({ kioskId: row.id, organizationId: company.orgId, assignedById: company.userId })) });
  await c.prisma.kiosk.update({ where: { id: kiosks[0].id }, data: { status: 'MAINTENANCE' } });
  await assert.rejects(assignTestModels(c.sql, plan, () => undefined));
  c.check('model-unavailable-stock-rolls-back', await c.prisma.kiosk.count({ where: { currentOrgId: company.orgId } }) === 4 && await c.prisma.kioskAssignment.count() === 3);
  await c.prisma.kiosk.update({ where: { id: kiosks[0].id }, data: { status: 'AVAILABLE' } });
  // Local-only compatibility test: the configured DB lacks this optional field.
  await c.sql.query('ALTER TABLE "Kiosk" RENAME COLUMN "reservedOrderId" TO "test_hidden_reservation"');
  try {
    const result = await assignTestModels(c.sql, plan, snapshot => c.record('model-assignment-before', snapshot));
    c.record('model-assignment-result', result);
    await assert.rejects(assignTestModels(c.sql, plan, () => undefined));
  } finally { await c.sql.query('ALTER TABLE "Kiosk" RENAME COLUMN "test_hidden_reservation" TO "reservedOrderId"'); }
  c.check('model-exact-ownership-and-no-duplicates', await c.prisma.kiosk.count({ where: { currentOrgId: distributor.orgId } }) === 3 && await c.prisma.kiosk.count({ where: { currentOrgId: company.orgId } }) === 1 && await c.prisma.kioskAssignment.count({ where: { assignedTo: null, organizationId: distributor.orgId } }) === 3 && await c.prisma.kioskAssignment.count() === 6);
  const response = await c.http('model-distributor-inventory', distributor, 'GET', '/api/kiosks', undefined, 200);
  assert.equal(response.status, 200);
  c.check('model-api-organization-labels', response.data.data.kiosks.length === 3 && response.data.data.kiosks.every((row: any) => row.currentOrg?.id === distributor.orgId && row.assignedOrg?.id === distributor.orgId));
}
