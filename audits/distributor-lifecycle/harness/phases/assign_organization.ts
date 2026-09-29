import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

// Runs in the existing isolated harness. Browser requests are forwarded through
// c.http to real application handlers; no API responses or inventory are mocked.
// Bootstrap company and initial assignment history are DB fixtures. Email stays in memory.
export async function run(c: any) {
  const quantity = Number(process.env.AUDIT_ASSIGN_QUANTITY || '2');
  assert(Number.isInteger(quantity) && quantity >= 1 && quantity <= 50);
  const company = await c.fixture('assignment-test-company', 'COMPANY');
  const organizationName = 'Kiosk Assignment Test Distributor';
  const ownerEmail = 'assignment-test-owner@example.invalid';
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.AUDIT_PLAYWRIGHT_MODULE || path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const pageErrors: string[] = [];
  page.on('pageerror', (error: Error) => pageErrors.push(error.message));
  let browserActor = company;
  let uiRequest = 0;
  function check(id: string, pass: boolean, details = {}) {
    c.check(id, pass, details);
    assert(pass, id);
  }
  async function hit(id: string, actor: any, method: string, route: string, body: any, expected: number) {
    const response = await c.http(id, actor, method, route, body, expected);
    assert.equal(response.status, expected, id);
    return response;
  }
  await page.route('**/api/**', async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method !== 'GET' && !(method === 'POST' && url.pathname === '/api/auth/register')) {
      await route.abort();
      throw new Error('Unexpected browser mutation: ' + method + ' ' + url.pathname);
    }
    const response = await c.http(`assignment-ui-${++uiRequest}`, browserActor, method, url.pathname + url.search, request.postData() ? request.postDataJSON() : undefined, method === 'POST' ? 201 : 200);
    await route.fulfill({ status: response.status, json: response.data });
  });
  try {
    await page.goto('http://localhost:3000/distributors/new', { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="orgName"]').fill(organizationName);
    await page.locator('input[name="ownerName"]').fill('Assignment Test Owner');
    await page.locator('input[name="ownerEmail"]').fill(ownerEmail);
    await page.locator('input[name="address"]').fill('Local test address, Mumbai');
    await page.locator('select[name="state"]').selectOption('Maharashtra');
    await page.locator('select[name="city"]').selectOption('Mumbai');
    await page.locator('input[name="pincode"]').fill('400001');
    await page.screenshot({ path: path.join(c.outDir, 'organization-form.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Register Distributor', exact: true }).click();
    await page.waitForURL('**/distributors');
    await page.getByText(organizationName, { exact: true }).waitFor();
    const created = await c.prisma.organization.findFirstOrThrow({ where: { name: organizationName }, include: { owner: true, memberships: true } });
    check('assignment-organization-created-through-ui', created.type === 'DISTRIBUTOR' && created.owner.email === ownerEmail && created.memberships.length === 1 && created.memberships[0].status === 'ACTIVE' && created.memberships[0].role === 'OWNER', { organizationId: created.id, organizationName });
    const message = c.mails.findLast((mail: any) => mail.To[0].Email === ownerEmail);
    const temporaryPassword = message?.TextPart.match(/Temporary Password:\s*([^\s]+)/)?.[1];
    assert(temporaryPassword, 'Credentials captured locally');
    const distributor = await c.login('assignment-test-owner', ownerEmail, temporaryPassword);
    await page.screenshot({ path: path.join(c.outDir, 'organization-created.png'), fullPage: true, animations: 'disabled' });

    // One extra company kiosk demonstrates that quantity selection is exact.
    await hit('assignment-mint-test-stock', company, 'POST', '/api/kiosks/batch', { count: quantity + 1, model: 'Arcade-LX B2C' }, 201);
    const stockBefore = await c.prisma.kiosk.findMany({ where: { currentOrgId: company.orgId }, orderBy: { machineCode: 'asc' } });
    await c.prisma.kioskAssignment.createMany({ data: stockBefore.map((kiosk: any) => ({ kioskId: kiosk.id, organizationId: company.orgId, assignedById: company.userId })) });
    c.record('assignment-initial-history-fixture', { count: stockBefore.length, purpose: 'Verify closed Company history does not replace the current Distributor name' });
    await hit('assignment-without-agreement-rejected', company, 'POST', '/api/orders/create', { type: 'ALLOCATION', targetOrgId: distributor.orgId, quantity }, 403);
    check('assignment-denial-keeps-stock', await c.prisma.kiosk.count({ where: { currentOrgId: company.orgId, status: 'AVAILABLE' } }) === quantity + 1);
    const connection = await c.connect('assignment-network', company, distributor);
    const agreement = await c.agreement('assignment-agreement', company, distributor, connection);
    const order = await c.order('assignment-allocation', company, 'ALLOCATION', distributor, quantity);
    const reserved = await c.snapshot('assignment-reserved', order.id);
    check('assignment-reserved-exact-quantity', reserved.status === 'APPROVED' && reserved.dispatchedKiosks.length === quantity && reserved.dispatchedKiosks.every((row: any) => row.kiosk.currentOrgId === company.orgId && row.kiosk.status === 'RESERVED' && row.kiosk.reservedOrderId === order.id));
    await hit('assignment-unpaid-dispatch-rejected', company, 'PATCH', `/api/orders/${order.id}/dispatch`, undefined, 402);
    await hit('assignment-test-payment-confirmed', company, 'PATCH', `/api/orders/${order.id}/paid`, undefined, 200);
    await hit('assignment-dispatched', company, 'PATCH', `/api/orders/${order.id}/dispatch`, undefined, 200);
    const dispatched = await c.snapshot('assignment-in-transit', order.id);
    check('assignment-in-transit-state', dispatched.status === 'DISPATCHED' && dispatched.dispatchedKiosks.every((row: any) => row.kiosk.status === 'ASSIGNED' && row.kiosk.currentOrgId === company.orgId));
    await hit('assignment-delivered', company, 'PATCH', `/api/orders/${order.id}/deliver`, undefined, 200);
    const delivered = await c.snapshot('assignment-delivered-proof', order.id);
    const assigned = delivered.dispatchedKiosks.map((row: any) => row.kiosk);
    check('assignment-owner-and-history-confirmed', delivered.status === 'DELIVERED' && assigned.length === quantity && assigned.every((kiosk: any) => kiosk.currentOrgId === distributor.orgId && kiosk.status === 'AVAILABLE' && kiosk.reservedOrderId === null && kiosk.assignments.filter((assignment: any) => assignment.assignedTo === null).length === 1 && kiosk.assignments.some((assignment: any) => assignment.assignedTo === null && assignment.organizationId === distributor.orgId && assignment.orderId === order.id)));
    const assignedIds = new Set(assigned.map((kiosk: any) => kiosk.id));
    const extra = stockBefore.find((kiosk: any) => !assignedIds.has(kiosk.id));
    const spare = await c.prisma.kiosk.findUniqueOrThrow({ where: { id: extra.id } });
    check('assignment-extra-stock-unchanged', spare.currentOrgId === company.orgId && spare.status === 'AVAILABLE' && spare.reservedOrderId === null);
    await hit('assignment-repeat-delivery-rejected', company, 'PATCH', `/api/orders/${order.id}/deliver`, undefined, 400);
    const inventory = await hit('assignment-distributor-inventory', distributor, 'GET', '/api/kiosks', undefined, 200);
    check('assignment-api-inventory-count', inventory.data.data.kiosks.length === quantity && inventory.data.data.kiosks.every((kiosk: any) => assignedIds.has(kiosk.id)));
    const isSafeOrg = (org: any) => org?.id === distributor.orgId && org.name === organizationName && org.type === 'DISTRIBUTOR' && Object.keys(org).sort().join(',') === 'id,name,type';
    const hasDisplayNames = (kiosk: any) => isSafeOrg(kiosk.currentOrg) && isSafeOrg(kiosk.assignedOrg) && !('assignments' in kiosk) && !('externalDeviceId' in kiosk);
    check('assignment-api-resolves-safe-organization-names', inventory.data.data.kiosks.every(hasDisplayNames));
    check('assignment-closed-history-retained', assigned.every((kiosk: any) => kiosk.assignments.some((row: any) => row.organizationId === company.orgId && row.assignedTo !== null)));
    const detail = await hit('assignment-kiosk-detail', distributor, 'GET', `/api/kiosks/${assigned[0].id}`, undefined, 200);
    check('assignment-detail-resolves-safe-organization-names', hasDisplayNames(detail.data.data.kiosk));
    await hit('assignment-other-owner-detail-denied', distributor, 'GET', `/api/kiosks/${spare.id}`, undefined, 403);
    const summary = await hit('assignment-distributor-summary', distributor, 'GET', '/api/kiosks/summary', undefined, 200);
    check('assignment-summary-count', summary.data.data.summary.AVAILABLE === quantity);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(organizationName, { exact: true }).waitFor();
    const organizationRow = page.locator('tbody tr').filter({ hasText: organizationName });
    check('assignment-company-ui-count', await organizationRow.locator('td').nth(4).innerText() === String(quantity));
    await page.screenshot({ path: path.join(c.outDir, 'organization-assigned-count.png'), fullPage: true, animations: 'disabled' });
    await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor();
    await page.getByLabel('Rows per page').selectOption('100');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    const companyHolderLabels = await page.locator('tbody tr td:nth-child(3)').allTextContents();
    check('assignment-company-ui-remaining-stock', companyHolderLabels.length === 1 && companyHolderLabels[0] === 'Unassigned' && await page.locator('tbody tr td:first-child .font-mono').innerText() === spare.machineCode, { labels: companyHolderLabels });
    await page.screenshot({ path: path.join(c.outDir, 'company-kiosk-assignments.png'), fullPage: true, animations: 'disabled' });
    browserActor = distributor;
    await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor();
    await page.getByText(`Showing 1–${Math.min(quantity, 10)} of ${quantity} machines`, { exact: true }).waitFor();
    if (quantity > 10) await page.getByLabel('Rows per page').selectOption(quantity > 25 ? '50' : '25');
    await page.waitForFunction((count: number) => document.querySelectorAll('tbody tr').length === count, quantity);
    const visibleCodes = await page.locator('tbody tr td:first-child .font-mono').allTextContents();
    check('assignment-distributor-ui-inventory', visibleCodes.length === quantity && visibleCodes.every((code: string) => assigned.some((kiosk: any) => kiosk.machineCode === code)));
    const holderLabels = await page.locator('tbody tr td:nth-child(3)').allTextContents();
    check('assignment-distributor-ui-names', holderLabels.length === quantity && holderLabels.every((label: string) => label === organizationName), { actualLabels: holderLabels, expectedOrganizationName: organizationName });
    await page.screenshot({ path: path.join(c.outDir, 'distributor-kiosks.png'), fullPage: true, animations: 'disabled' });
    check('assignment-no-browser-errors', pageErrors.length === 0, { pageErrors });
    const result = { organizationName, organizationId: distributor.orgId, quantity, orderId: order.id, orderNumber: order.orderNumber, orderStatus: delivered.status, networkId: connection.id, agreementId: agreement.id, kiosks: assigned.map((kiosk: any) => ({ id: kiosk.id, machineCode: kiosk.machineCode, status: kiosk.status, ownerOrganizationId: kiosk.currentOrgId })), unassignedSpare: { id: spare.id, machineCode: spare.machineCode }, uiHolderLabels: holderLabels, scope: 'New isolated local database; real UI registration and real API transfer; captured email only; no real payment made' };
    c.record('assignment-test-result', result);
    fs.writeFileSync(path.join(c.outDir, 'assignment-result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(c.outDir, 'ASSIGNMENT.md'), `# Organization and kiosk assignment test\n\nCreated **${organizationName}** through the frontend and transferred **${quantity} kiosks** using the real API.\n\n- Organization: \`${distributor.orgId}\`\n- Order: \`${order.orderNumber}\` / \`${order.id}\`\n- State: DELIVERED; each kiosk is AVAILABLE and owned by the Distributor.\n- Kiosks: ${assigned.map((kiosk: any) => '`' + kiosk.machineCode + '`').join(', ')}\n- Extra kiosk \`${spare.machineCode}\` stayed with the Company.\n- Company Distributor list and Distributor kiosk inventory display the correct count.\n\nThe Kiosks screen currently has no assignment control. Assignment required the existing network, agreement, allocation, test payment, dispatch and delivery API flow. The Assigned To cells display ${JSON.stringify(holderLabels)} and resolve the current Distributor name, while closed Company assignment history is retained. The Company view displays only the spare kiosk as Unassigned; transferred kiosks appear in the Distributor inventory.\n\nThis test used a new isolated local database and captured email. The configured live database and existing inventory were not changed, and no real payment was made.\n\n![Distributor count](organization-assigned-count.png)\n\n![Distributor kiosks](distributor-kiosks.png)\n`);
  } catch (error) {
    await page.screenshot({ path: path.join(c.outDir, 'assignment-failure.png'), fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}
