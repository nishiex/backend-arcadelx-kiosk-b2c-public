import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncRevenueData } from '../../../../apps/api/src/services/Revenue/revenueTransaction.services';
import { processRevenueStatement } from '../../../../apps/api/src/services/Revenue/revenueStatement.service';
import { statementJobId } from '../../../../apps/api/src/queues/Revenue/revenueStatement.queue';
import { previousRevenueMonth, revenueJobPeriod } from '../../../../apps/api/src/workers/Revenue/revenue.worker';
import { REVENUE_REPORTS_DIR } from '../../../../apps/api/src/services/pdf/revenue.pdf';

export async function run(c: any) {
  const { prisma, http, check } = c;
  const company = c.company;
  const distributor = await c.fixture('revenue-distributor', 'DISTRIBUTOR');
  const partner = await c.fixture('revenue-partner', 'PARTNER');
  const other = await c.fixture('revenue-other-distributor', 'DISTRIBUTOR');
  const staff = await c.fixture('revenue-staff', 'COMPANY', company.orgId, 'STAFF');
  const start = new Date('2025-12-31T18:30:00Z'), transfer = new Date('2026-01-15T18:30:00Z');
  const network = await prisma.networkConnection.create({ data: { initiatorOrgId: company.orgId, receiverOrgId: distributor.orgId, status: 'ACTIVE' } });
  const terms = { networkConnectionId: network.id, parentOrgId: company.orgId, childOrgId: distributor.orgId, depositAmountPerMachine: 0, nonRefundableAmountPerMachine: 0 };
  await prisma.agreement.create({ data: { ...terms, parentSharePct: 40, childSharePct: 60, effectiveFrom: start, effectiveTo: transfer, status: 'TERMINATED' } });
  await prisma.agreement.create({ data: { ...terms, parentSharePct: 50, childSharePct: 50, effectiveFrom: transfer, status: 'ACTIVE' } });
  const partnerNetwork = await prisma.networkConnection.create({ data: { initiatorOrgId: distributor.orgId, receiverOrgId: partner.orgId, status: 'ACTIVE' } });
  await prisma.agreement.create({ data: { ...terms, networkConnectionId: partnerNetwork.id, parentOrgId: distributor.orgId, childOrgId: partner.orgId, parentSharePct: 60, childSharePct: 40, effectiveFrom: transfer, status: 'ACTIVE' } });
  const kiosk = await prisma.kiosk.create({ data: { machineCode: 'REVENUE-TEST-' + crypto.randomUUID(), model: 'Test', externalDeviceId: crypto.randomUUID(), currentOrgId: partner.orgId } });
  await prisma.kioskAssignment.create({ data: { kioskId: kiosk.id, organizationId: distributor.orgId, assignedById: company.userId, assignedFrom: start, assignedTo: transfer } });
  await prisma.kioskAssignment.create({ data: { kioskId: kiosk.id, organizationId: partner.orgId, assignedById: company.userId, assignedFrom: transfer } });
  const realFetch = globalThis.fetch;
  const transactions = [
    { txnid: crypto.randomUUID(), device_id: kiosk.externalDeviceId, game_id: 'game', status: 'completed', amount: '100.00', currency: 'INR', updated_at: '2026-01-10T12:00:00Z' },
    { txnid: crypto.randomUUID(), device_id: kiosk.machineCode, game_id: 'game', status: 'completed', amount: '100.00', currency: 'INR', updated_at: '2026-01-20T12:00:00Z' },
    { txnid: crypto.randomUUID(), device_id: kiosk.machineCode, game_id: 'game', status: 'completed', amount: '20.00', currency: 'INR', updated_at: '2026-01-31T18:30:00Z' },
  ];
  process.env.MOTHERSHIP_TRANSACTION_API_URL = 'https://mothership.example.invalid/transactions';
  globalThis.fetch = async (input, init) => String(input) === process.env.MOTHERSHIP_TRANSACTION_API_URL ? Response.json([...transactions, transactions[0], { ...transactions[0], txnid: 'unknown', device_id: 'unknown' }, { ...transactions[0], txnid: 'pending', status: 'pending' }]) : realFetch(input, init);
  try {
    const first = await syncRevenueData();
    assert.equal(first.newRecordsInserted, 3); assert.equal(first.unattributedCount, 1);
    assert.equal((await syncRevenueData()).newRecordsInserted, 0);
    check('revenue-import-device-and-machine-mapping-idempotent', true);
    globalThis.fetch = async (input, init) => String(input) === process.env.MOTHERSHIP_TRANSACTION_API_URL ? Response.json([{ ...transactions[0], txnid: 'bad', amount: '-1' }]) : realFetch(input, init);
    await assert.rejects(syncRevenueData(), /Rejected transaction/);
    assert.equal(await prisma.transaction.count({ where: { externalTransactionId: 'bad' } }), 0);
    assert.ok(await prisma.revenueSyncRunLog.count({ where: { status: 'FAILED' } }));
    check('revenue-malformed-import-recorded-and-retryable', true);
  } finally { globalThis.fetch = realFetch; }
  for (const [actor, amount] of [[distributor, 220], [partner, 120], [other, 0]] as const) {
    const response = await http('revenue-scoping-' + actor.label, actor, 'GET', '/api/revenue/machine-wise', undefined, 200);
    assert.equal(response.data.data.kiosks.reduce((sum: number, row: any) => sum + row.totalRevenue, 0), amount);
    assert.ok(!JSON.stringify(response.data).includes('inviteCode'));
  }
  await http('revenue-staff-denied', staff, 'GET', '/api/revenue/machine-wise', undefined, 403);
  await http('revenue-anonymous-denied', null, 'GET', '/api/revenue/machine-wise', undefined, 401);
  const settingsBefore = await prisma.systemSettings.count();
  await http('revenue-settings-readable', partner, 'GET', '/api/revenue/deduction-rates', undefined, 200);
  assert.equal(await prisma.systemSettings.count(), settingsBefore, 'Settings GET performs no write');
  await http('revenue-settings-owner-update', company, 'PATCH', '/api/revenue/deduction-rates', { gstPercentage: 18, pgFeePercentage: 2.5, tdsPercentage: 2 }, 200);
  await http('revenue-settings-staff-denied', staff, 'PATCH', '/api/revenue/deduction-rates', { tdsPercentage: 1 }, 403);
  await http('revenue-settings-distributor-denied', distributor, 'PATCH', '/api/revenue/deduction-rates', { tdsPercentage: 1 }, 403);
  await http('revenue-settings-invalid-deductions', company, 'PATCH', '/api/revenue/deduction-rates', { gstPercentage: 99 }, 400);
  await assert.rejects(processRevenueStatement(distributor.orgId, 13, 2026), /Invalid statement/);
  c.setFailMail(true);
  try { await assert.rejects(processRevenueStatement(distributor.orgId, 1, 2026), /email is pending/); }
  finally { c.setFailMail(false); }
  const statement = await prisma.revenueStatement.findUniqueOrThrow({ where: { organizationId_Month_Year: { organizationId: distributor.orgId, Month: 1, Year: 2026 } } });
  assert.equal(String(statement.GrossRevenue), '200'); assert.equal(String(statement.companyShare), '71.55');
  assert.equal(String(statement.distributorShare), '71.55'); assert.equal(String(statement.partnerShare), '15.9');
  assert.equal(String(statement.tdsAmount), '1.43'); assert.equal(String(statement.finalPayout), '70.12');
  const pdf = await fs.readFile(path.join(REVENUE_REPORTS_DIR, statement.pdfPath));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(statement.pdfPath.startsWith('2026-01')); assert.ok(!statement.pdfPath.includes('{'));
  check('revenue-historical-agreements-assignment-windows-IST-and-money', true);
  const mailCount = c.mails.length;
  await Promise.allSettled([processRevenueStatement(distributor.orgId, 1, 2026), processRevenueStatement(distributor.orgId, 1, 2026)]);
  await processRevenueStatement(distributor.orgId, 1, 2026);
  assert.equal(c.mails.length, mailCount + 1);
  assert.equal(await prisma.revenueStatement.count({ where: { organizationId: distributor.orgId, Month: 1, Year: 2026 } }), 1);
  const job = await prisma.emailDelivery.findUniqueOrThrow({ where: { key: 'revenue:' + statement.id + ':statement' } });
  assert.ok(job.sentAt); assert.equal(job.payload, '');
  check('revenue-failed-email-retry-without-duplicate-statement-or-send', true);
  const partnerStatementId = await processRevenueStatement(partner.orgId, 1, 2026);
  const partnerStatement = await prisma.revenueStatement.findUniqueOrThrow({ where: { id: partnerStatementId } });
  assert.equal(String(partnerStatement.GrossRevenue), '100'); assert.equal(String(partnerStatement.finalPayout), '15.58');
  assert.equal(await processRevenueStatement(other.orgId, 1, 2026), null);
  assert.notEqual(statementJobId(partner.orgId, 1, 2026), statementJobId(distributor.orgId, 1, 2026));
  assert.notEqual(statementJobId(partner.orgId, 1, 2026), statementJobId(partner.orgId, 2, 2026));
  assert.deepEqual(previousRevenueMonth(new Date('2025-12-31T20:30:00Z')), { month: 12, year: 2025 });
  assert.deepEqual(revenueJobPeriod({ timestamp: Date.parse('2025-12-01T00:00:00Z'), opts: { prevMillis: Date.parse('2025-12-31T20:30:00Z') } }), { month: 12, year: 2025 });
  const beforeMigration = JSON.stringify(await prisma.revenueStatement.findMany({ orderBy: { id: 'asc' } }));
  const sql = await fs.readFile(path.resolve('apps/api/prisma/migrations/20261005180000_integrate_revenue/migration.sql'), 'utf8');
  await c.sql.query(sql);
  assert.equal(JSON.stringify(await prisma.revenueStatement.findMany({ orderBy: { id: 'asc' } })), beforeMigration);
  check('revenue-additive-migration-preserves-existing-statements', true);
  check('revenue-partner-payout-unique-jobs-and-IST-year-boundary', true);
}
