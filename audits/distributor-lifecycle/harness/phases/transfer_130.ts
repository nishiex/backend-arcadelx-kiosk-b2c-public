import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Fresh, fully migrated LOCAL database supplied by the existing harness.
// Reproduces the requested count/recipient/terms using synthetic accounts and
// real HTTP handlers. Does not copy or repair the running database's old order.
export async function run(c: any) {
  assert(['localhost', '127.0.0.1'].includes(c.auditUrl.hostname));
  assert(c.auditUrl.pathname.startsWith('/arcadelx_audit_'));
  const preflightPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../requested-assignment-preflight.json');
  const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
  const recipient = preflight.organizations.find((org: any) => org.name === 'Test Distributor Pvt Ltf');
  const source = preflight.organizations.find((org: any) => org.type === 'COMPANY');
  assert(recipient && source);
  const terms = preflight.agreements.find((row: any) => row.parentOrgId === source.id && row.childOrgId === recipient.id && row.status === 'ACTIVE');
  assert(terms);
  assert.equal(preflight.kiosks.reduce((count: number, row: any) => count + row.count, 0), 130);
  const company = await c.fixture('transfer-company', 'COMPANY');
  const distributor = await c.fixture('transfer-distributor', 'DISTRIBUTOR');
  const other = await c.fixture('transfer-unrelated', 'DISTRIBUTOR');
  await c.prisma.organization.update({ where: { id: company.orgId }, data: { name: source.name } });
  await c.prisma.organization.update({ where: { id: distributor.orgId }, data: { name: recipient.name } });
  c.record('transfer-fixture-scope', { scope: 'New fully migrated local DB; synthetic identities; same count, organization names and agreement terms as read-only preflight', configuredDatabaseChanged: false });
  const check = (id: string, pass: boolean, details = {}) => { c.check(id, pass, details); assert(pass, id); };
  const hit = async (id: string, actor: any, method: string, route: string, body: any, expected: number) => {
    const response = await c.http(id, actor, method, route, body, expected);
    assert.equal(response.status, expected, id);
    return response.data.data;
  };
  const connection = await c.connect('transfer-network', company, distributor);
  await c.agreement('transfer-agreement', company, distributor, connection, {
    parentSharePct: Number(terms.parentSharePct), childSharePct: Number(terms.childSharePct),
    depositAmountPerMachine: terms.depositAmountPerMachine, nonRefundableAmountPerMachine: terms.nonRefundableAmountPerMachine,
  });
  for (const count of [100, 30]) await hit(`transfer-mint-${count}`, company, 'POST', '/api/kiosks/batch', { count, model: count === 100 ? 'Arcade-LX B2C' : 'Arcade-LX Pro' }, 201);
  const before = await c.prisma.kiosk.findMany({ orderBy: { machineCode: 'asc' } });
  const originalIds = new Set(before.map((row: any) => row.id));
  // Add initial ownership ledger to verify that transfer closes rather than deletes it.
  await c.prisma.kioskAssignment.createMany({ data: before.map((kiosk: any) => ({ kioskId: kiosk.id, organizationId: company.orgId, assignedById: company.userId })) });
  c.record('transfer-initial-history-fixture', { count: before.length, purpose: 'Ensure previous Company history is retained' });
  const stages: any[] = [];
  async function verifyStage(label: string, transferred: number, reserved = 0, inTransit = 0) {
    const rows = await c.prisma.kiosk.findMany({ select: { id: true, currentOrgId: true, status: true, reservedOrderId: true } });
    const companyOwned = rows.filter((row: any) => row.currentOrgId === company.orgId);
    const distributorOwned = rows.filter((row: any) => row.currentOrgId === distributor.orgId);
    const activeAssignments = await c.prisma.kioskAssignment.findMany({ where: { assignedTo: null }, select: { kioskId: true, organizationId: true } });
    const companyInventory = await hit(`${label}-company-api`, company, 'GET', '/api/kiosks', undefined, 200);
    const distributorInventory = await hit(`${label}-distributor-api`, distributor, 'GET', '/api/kiosks', undefined, 200);
    const companySummary = await hit(`${label}-company-summary`, company, 'GET', '/api/kiosks/summary', undefined, 200);
    const distributorSummary = await hit(`${label}-distributor-summary`, distributor, 'GET', '/api/kiosks/summary', undefined, 200);
    const summaryCount = (summary: any) => Object.values(summary).reduce((total: number, count: any) => total + count, 0);
    const stage = { label, companyOwned: companyOwned.length, distributorOwned: distributorOwned.length, companyAvailable: companySummary.summary.AVAILABLE || 0, reserved, inTransit, companyListRows: companyInventory.kiosks.length, distributorListRows: distributorInventory.kiosks.length };
    check(`${label}-ownership-and-inventory`,
      rows.length === 130 && rows.every((row: any) => originalIds.has(row.id)) &&
      companyOwned.length === 130 - transferred && distributorOwned.length === transferred &&
      companyOwned.filter((row: any) => row.status === 'RESERVED').length === reserved &&
      companyOwned.filter((row: any) => row.status === 'ASSIGNED').length === inTransit &&
      companyOwned.filter((row: any) => row.status === 'AVAILABLE').length === 130 - transferred - reserved - inTransit &&
      distributorOwned.every((row: any) => row.status === 'AVAILABLE' && row.reservedOrderId === null) &&
      companyInventory.kiosks.length === 130 && distributorInventory.kiosks.length === transferred &&
      distributorInventory.kiosks.every((row: any) => row.currentOrgId === distributor.orgId && row.currentOrg?.name === recipient.name && row.assignedOrg?.name === recipient.name) &&
      summaryCount(companySummary.summary) === 130 - transferred && summaryCount(distributorSummary.summary) === transferred &&
      activeAssignments.length === 130 && new Set(activeAssignments.map((row: any) => row.kioskId)).size === 130 &&
      activeAssignments.every((assignment: any) => rows.find((row: any) => row.id === assignment.kioskId)?.currentOrgId === assignment.organizationId), stage);
    stages.push(stage);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  let actor = company;
  let requestNumber = 0;
  await page.route('**/api/**', async (route: any) => {
    const request = route.request();
    assert.equal(request.method(), 'GET', 'Browser verification must be read-only');
    const url = new URL(request.url());
    const response = await c.http(`transfer-ui-${++requestNumber}`, actor, 'GET', url.pathname + url.search, undefined, 200);
    await route.fulfill({ status: response.status, json: response.data });
  });
  async function verifyTable(label: string, owner: any, assignedTo: string, expected = before) {
    actor = owner;
    await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor();
    if (expected.length === 0) {
      await page.getByText('No machines in your inventory.', { exact: true }).waitFor();
      check(`${label}-empty`, await page.locator('tbody tr').count() === 0 && await page.getByLabel('Model', { exact: true }).locator('option').count() === 1 && await page.getByRole('button', { name: 'Next page', exact: true }).isDisabled());
      await page.screenshot({ path: path.join(c.outDir, `${label}-empty.png`), fullPage: true, animations: 'disabled' });
      return;
    }
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0);
    await page.getByLabel('Rows per page').selectOption('100');
    await page.waitForFunction((count: number) => document.querySelectorAll('tbody tr').length === count, Math.min(100, expected.length));
    const models = await page.getByLabel('Model', { exact: true }).locator('option').allTextContents();
    check(`${label}-owned-model-options`, JSON.stringify(models) === JSON.stringify(['All models', ...new Set(expected.map((row: any) => row.model).sort())]));
    const codes: string[] = [];
    let pageNumber = 1;
    while (true) {
      const labels = await page.locator('tbody tr td:nth-child(3)').allTextContents();
      const pageCodes = await page.locator('tbody tr td:first-child .font-mono').allTextContents();
      check(`${label}-page-${pageNumber}`, labels.length === pageCodes.length && labels.every((name: string) => name === assignedTo));
      codes.push(...pageCodes);
      await page.screenshot({ path: path.join(c.outDir, `${label}-page-${pageNumber}.png`), fullPage: true, animations: 'disabled' });
      const next = page.getByRole('button', { name: 'Next page', exact: true });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForFunction((count: number) => document.querySelectorAll('tbody tr').length === count, Math.min(100, expected.length - codes.length));
      pageNumber++;
    }
    check(`${label}-all-kiosks`, codes.length === expected.length && new Set(codes).size === expected.length && expected.every((row: any) => codes.includes(row.machineCode)));
  }
  async function verifyDashboard(label: string, owner: any, expected: any[]) {
    actor = owner;
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    const recent = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent kiosks', exact: true }) });
    if (expected.length) await recent.locator('li').first().waitFor();
    else await recent.getByText('No kiosks in your inventory.', { exact: true }).waitFor();
    const codes = await recent.locator('li .font-mono').allTextContents();
    check(`${label}-recent-ownership`, codes.length === Math.min(8, expected.length) && codes.every((code: string) => expected.some((row: any) => row.machineCode === code)));
    const total = page.locator('[data-reveal]').filter({ has: page.getByText('Total Kiosks', { exact: true }) }).locator('.tabular-nums');
    await total.getByText(String(expected.length), { exact: true }).waitFor();
    check(`${label}-total`, await total.innerText() === String(expected.length));
    await page.screenshot({ path: path.join(c.outDir, `${label}.png`), fullPage: true, animations: 'disabled' });
  }
  const orders: any[] = [];
  try {
    await verifyStage('transfer-before', 0);
    await verifyTable('company-before', company, 'Unassigned');
    await verifyDashboard('company-dashboard-before', company, before);
    await hit('transfer-130-in-one-order-denied', company, 'POST', '/api/orders/create', { type: 'ALLOCATION', targetOrgId: distributor.orgId, quantity: 130 }, 400);
    check('transfer-oversize-no-orders-created', await c.prisma.order.count() === 0);
    let transferred = 0;
    for (const [index, quantity] of [20, 50, 50, 10].entries()) {
      const prefix = `transfer-batch-${index + 1}`;
      const requester = index === 0 ? distributor : company;
      const type = index === 0 ? 'REQUEST' : 'ALLOCATION';
      const target = index === 0 ? company : distributor;
      const { order } = await hit(`${prefix}-create`, requester, 'POST', '/api/orders/create', { type, targetOrgId: target.orgId, quantity }, 201);
      if (index === 0) {
        await verifyStage(`${prefix}-requested`, transferred);
        await hit(`${prefix}-approve`, company, 'PATCH', `/api/orders/${order.id}/approve`, undefined, 200);
      }
      await verifyStage(`${prefix}-reserved`, transferred, quantity);
      await hit(`${prefix}-unpaid-dispatch-denied`, company, 'PATCH', `/api/orders/${order.id}/dispatch`, undefined, 402);
      await hit(`${prefix}-test-paid`, company, 'PATCH', `/api/orders/${order.id}/paid`, undefined, 200);
      await hit(`${prefix}-dispatch`, company, 'PATCH', `/api/orders/${order.id}/dispatch`, undefined, 200);
      await verifyStage(`${prefix}-dispatched`, transferred, 0, quantity);
      await hit(`${prefix}-deliver`, company, 'PATCH', `/api/orders/${order.id}/deliver`, undefined, 200);
      transferred += quantity;
      await verifyStage(`${prefix}-delivered`, transferred);
      if (index === 0 || index === 2) {
        const remaining = await c.prisma.kiosk.findMany({ where: { currentOrgId: company.orgId } });
        await verifyTable(`${prefix}-company-remaining`, company, 'Unassigned', remaining);
        await verifyDashboard(`${prefix}-company-dashboard`, company, remaining);
      }
      await hit(`${prefix}-repeat-delivery-denied`, company, 'PATCH', `/api/orders/${order.id}/deliver`, undefined, 400);
      orders.push({ id: order.id, orderNumber: order.orderNumber, quantity });
    }
    const finalOrders = await c.prisma.order.findMany({ include: { dispatchedKiosks: true, kioskAssignments: true } });
    const closedCompanyHistory = await c.prisma.kioskAssignment.count({ where: { organizationId: company.orgId, assignedTo: { not: null } } });
    check('transfer-orders-and-history', finalOrders.length === 4 && finalOrders.every((order: any) => order.status === 'DELIVERED' && order.dispatchedKiosks.length === order.quantity && order.kioskAssignments.length === order.quantity) && closedCompanyHistory === 130);
    await hit('transfer-unrelated-org-detail-denied', other, 'GET', `/api/kiosks/${before[0].id}`, undefined, 403);
    await verifyTable('company-after', company, 'Unassigned', []);
    await verifyDashboard('company-dashboard-after', company, []);
    await verifyTable('distributor-after', distributor, recipient.name);
    await verifyDashboard('distributor-dashboard-after', distributor, before);
    actor = company;
    await page.goto('http://localhost:3000/distributors', { waitUntil: 'domcontentloaded' });
    const recipientRow = page.locator('tbody tr').filter({ hasText: recipient.name });
    await recipientRow.waitFor();
    check('transfer-distributor-list-count', await recipientRow.locator('td').nth(4).innerText() === '130');
    await page.screenshot({ path: path.join(c.outDir, 'distributor-count-130.png'), fullPage: true, animations: 'disabled' });
    check('transfer-no-browser-errors', errors.length === 0, { errors });
    const kiosks = await c.prisma.kiosk.findMany({ select: { id: true, machineCode: true, currentOrgId: true, status: true }, orderBy: { machineCode: 'asc' } });
    const proof = { scope: 'Isolated local fully migrated test database; synthetic accounts and inventory; real HTTP and browser; simulated payment/delivery; no external mail', organizationName: recipient.name, companyId: company.orgId, distributorId: distributor.orgId, quantity: 130, orders, stages, kiosks, runningDatabaseChanged: false };
    fs.writeFileSync(path.join(c.outDir, 'transfer-proof.json'), JSON.stringify(proof, null, 2));
    fs.writeFileSync(path.join(c.outDir, 'TRANSFER.md'), `# Company to Distributor transfer verified\n\nAll **130 kiosks** transferred to **${recipient.name}** through real HTTP handlers in a new, fully migrated local test database. Accounts and inventory were synthetic; names, quantity and agreement terms matched the running-app preflight. The existing running-app order was not copied or repaired.\n\n| Stage | Company-owned | Distributor-owned |\n| --- | ---: | ---: |\n| Before | 130 | 0 |\n| After all deliveries | 0 | 130 |\n\nOrders used quantities **20, 50, 50, 10**. Reservation and dispatch kept each batch Company-owned; only delivery changed ownership. Every batch retained its exact linked kiosk quantity, and duplicate delivery was rejected. All 130 previous Company assignments were closed and retained; each kiosk has one open Distributor assignment.\n\nCompany inventory summary dropped to zero. The Company Kiosks screen and Recent kiosks dashboard became empty. The backend Company list still permits administrative visibility, while the frontend now selects current ownership. Partial-transfer checks also verified only the remaining 110 and then 10 Company-owned machines, model options and dashboard rows were visible. The Distributor inventory and Company Distributor-list count both showed 130. Every row was checked across two pages in each kiosk view.\n\nPayment/delivery were simulated locally; no real payment or external email. The running database and its current 20-kiosk order were unchanged. Its missing lifecycle migration and inconsistent order remain deployment blockers.\n\n[Machine-by-machine proof](transfer-proof.json) · [HTTP/database assertions](evidence.json)\n\n![Company dashboard after transfer](company-dashboard-after.png)\n\n![Company inventory after transfer](company-after-empty.png)\n\n![Distributor owns 130](distributor-count-130.png)\n\n![Distributor kiosk inventory, last page](distributor-after-page-2.png)\n`);
    c.record('transfer-final-result', { companyOwned: 0, distributorOwned: 130, companyApiVisible: 130, companyUiVisible: 0, recipient: recipient.name, runningDatabaseChanged: false });
  } catch (error) {
    await page.screenshot({ path: path.join(c.outDir, 'transfer-failure.png'), fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await browser.close(); }
}
