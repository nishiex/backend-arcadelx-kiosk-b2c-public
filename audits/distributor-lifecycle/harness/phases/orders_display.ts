import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Real HTTP lifecycle and browser reads against a fresh local harness database.
export async function run(c: any) {
  const check = (id: string, pass: boolean) => { c.check(id, pass); assert(pass, id); };
  async function hit(id: string, actor: any, method: string, route: string, body: any, expected = 200) {
    const response = await c.http(id, actor, method, route, body, expected);
    assert.equal(response.status, expected, id);
    return response;
  }
  const company = await c.fixture('orders-company', 'COMPANY');
  const distributor = await c.register('orders-distributor', company);
  const unrelated = await c.fixture('orders-unrelated', 'DISTRIBUTOR');
  const staff = await c.fixture('orders-company-staff', 'COMPANY', company.orgId, 'STAFF');
  const pending = await c.fixture('orders-pending', 'COMPANY', company.orgId, 'STAFF', 'PENDING');
  const connection = await c.connect('orders-connection', company, distributor);
  await c.agreement('orders-agreement', company, distributor, connection);
  await hit('orders-stock-a', company, 'POST', '/api/kiosks/batch', { count: 1, model: 'Order model A' }, 201);
  await hit('orders-stock-b', company, 'POST', '/api/kiosks/batch', { count: 2, model: 'Order model B' }, 201);
  const request = await c.order('orders-incoming-request', distributor, 'REQUEST', company, 1);
  const allocation = await c.order('orders-outgoing-allocation', company, 'ALLOCATION', distributor, 2);
  const dispatched = await c.order('orders-dispatched-request', distributor, 'REQUEST', company, 1);
  for (const action of ['approve', 'paid', 'dispatch']) await hit('orders-prepare-' + action, company, 'PATCH', `/api/orders/${dispatched.id}/${action}`, undefined);

  const list = (await hit('orders-company-list', company, 'GET', '/api/orders', undefined)).data.data.orders;
  check('orders-list-party-types', list.length === 3 && list.every((o: any) => o.parentOrg.type === 'COMPANY' && o.childOrg.type === 'DISTRIBUTOR'));
  await hit('orders-anonymous-list-denied', null, 'GET', '/api/orders', undefined, 401);
  await hit('orders-anonymous-detail-denied', null, 'GET', `/api/orders/${allocation.id}`, undefined, 401);
  await hit('orders-other-org-detail-hidden', unrelated, 'GET', `/api/orders/${allocation.id}`, undefined, 404);
  await hit('orders-pending-detail-denied', pending, 'GET', `/api/orders/${allocation.id}`, undefined, 403);
  await hit('orders-staff-can-read-own-order', staff, 'GET', `/api/orders/${allocation.id}`, undefined);
  await hit('orders-invalid-id', company, 'GET', '/api/orders/not-a-uuid', undefined, 400);
  await hit('orders-absent-id', company, 'GET', `/api/orders/${randomUUID()}`, undefined, 404);
  await hit('orders-invalid-status', company, 'GET', '/api/orders?status=BAD_STATUS', undefined, 400);
  const unrelatedList = (await hit('orders-other-org-list', unrelated, 'GET', '/api/orders', undefined)).data.data.orders;
  check('orders-list-excludes-other-organizations', unrelatedList.length === 0);

  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
  let actor = company;
  let sequence = 0;
  const urls: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error: Error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route: any) => {
    const req = route.request();
    assert.equal(req.method(), 'GET', 'Order viewing must not perform mutations');
    const url = new URL(req.url());
    urls.push(url.pathname + url.search);
    const response = await hit('orders-ui-' + (++sequence), actor, 'GET', url.pathname + url.search, undefined);
    await route.fulfill({ status: response.status, json: response.data });
  });
  const rows = () => page.locator('table').first().locator('tbody tr');
  async function waitRows(count: number) {
    await page.waitForFunction(n => document.querySelector('table')?.querySelectorAll('tbody tr').length === n, count);
  }
  try {
    await page.goto('http://localhost:3000/orders', { waitUntil: 'networkidle' });
    await waitRows(3);
    check('orders-company-navigation-visible', await page.getByRole('link', { name: 'Orders', exact: true }).count() === 1);
    check('orders-company-incoming-request-label', (await rows().filter({ hasText: request.orderNumber }).innerText()).includes('Requested from us'));
    check('orders-company-outgoing-allocation-label', (await rows().filter({ hasText: allocation.orderNumber }).innerText()).includes('Allocated by us'));

    await c.finishOrder('orders-complete-allocation', company, allocation);
    const detail = (await hit('orders-company-detail-after-transfer', company, 'GET', `/api/orders/${allocation.id}`, undefined)).data.data.order;
    check('orders-delivered-remains-visible-to-company', detail.status === 'DELIVERED' && detail.dispatchedKiosks.length === 2);
    check('orders-transferred-kiosk-owner', await c.prisma.kiosk.count({ where: { currentOrgId: distributor.orgId } }) === 2);
    check('orders-detail-limits-kiosk-fields', detail.dispatchedKiosks.every((row: any) => Object.keys(row.kiosk).sort().join(',') === 'id,machineCode,model,status'));
    await hit('orders-child-detail-after-transfer', distributor, 'GET', `/api/orders/${allocation.id}`, undefined);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await rows().filter({ hasText: allocation.orderNumber }).getByText('Delivered', { exact: true }).waitFor();
    check('orders-ui-refresh-after-transfer', await rows().count() === 3);
    await page.getByRole('button', { name: `View order ${allocation.orderNumber}`, exact: true }).click();
    await page.getByRole('heading', { name: 'Linked kiosks (2)', exact: true }).waitFor();
    check('orders-dialog-shows-real-models', await page.getByRole('dialog').getByText('Order model A', { exact: true }).count() === 1 && await page.getByRole('dialog').getByText('Order model B', { exact: true }).count() === 1);
    await page.screenshot({ path: path.join(c.outDir, 'order-details.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Filter order status' }).selectOption('DELIVERED');
    await waitRows(1);
    check('orders-status-sent-to-backend', urls.includes('/api/orders?status=DELIVERED'));
    check('orders-delivered-filter-row', (await rows().innerText()).includes(allocation.orderNumber));
    await page.getByRole('combobox', { name: 'Filter order status' }).selectOption('');
    await waitRows(3);
    await page.getByRole('combobox', { name: 'Filter order direction' }).selectOption('INCOMING');
    await waitRows(2);
    await page.getByRole('combobox', { name: 'Filter order direction' }).selectOption('OUTGOING');
    await waitRows(1);
    check('orders-company-direction-filter', (await rows().innerText()).includes(allocation.orderNumber));
    await page.getByRole('combobox', { name: 'Filter order direction' }).selectOption('');
    await page.getByRole('textbox', { name: 'Search order number' }).fill(request.orderNumber.toLowerCase());
    await waitRows(1);
    check('orders-search-number', (await rows().innerText()).includes(request.orderNumber));
    await page.getByRole('textbox', { name: 'Search order number' }).fill('no-such-order');
    await page.getByText('No orders match your filters.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search order number' }).fill('');
    await waitRows(3);
    await page.screenshot({ path: path.join(c.outDir, 'company-orders-light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.screenshot({ path: path.join(c.outDir, 'company-orders-dark.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    check('orders-mobile-no-page-overflow', await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
    await page.getByRole('button', { name: `View order ${allocation.orderNumber}`, exact: true }).click();
    await page.getByRole('heading', { name: 'Linked kiosks (2)', exact: true }).waitFor();
    const box = await page.getByRole('dialog').boundingBox();
    check('orders-mobile-dialog-fits', !!box && box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: path.join(c.outDir, 'orders-mobile-details.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 950 });
    actor = distributor;
    await page.reload({ waitUntil: 'networkidle' });
    await waitRows(3);
    check('orders-distributor-perspective', (await rows().filter({ hasText: allocation.orderNumber }).innerText()).includes('Allocated to us') && (await rows().filter({ hasText: request.orderNumber }).innerText()).includes('Requested by us'));
    actor = unrelated;
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('No orders yet. Orders will appear here when a machine request or allocation is created.', { exact: true }).waitFor();
    check('orders-ui-no-errors', pageErrors.length === 0);
  } finally { await browser.close(); }
}
