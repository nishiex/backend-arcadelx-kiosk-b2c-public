import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

export async function run(c: any) {
  const check = (id: string, pass: boolean) => { c.check(id, pass); assert(pass, id); };
  const hit = async (id: string, actor: any, method: string, route: string, body?: any, expected: number | number[] = 200) => {
    const r = await c.http(id, actor, method, route, body, expected);
    assert((Array.isArray(expected) ? expected : [expected]).includes(r.status), id);
    return r;
  };
  const company = await c.fixture('status-company', 'COMPANY');
  const admin = await c.fixture('status-company-admin', 'COMPANY', company.orgId, 'ADMIN');
  const manager = await c.fixture('status-company-manager', 'COMPANY', company.orgId, 'MANAGER');
  const staff = await c.fixture('status-company-staff', 'COMPANY', company.orgId, 'STAFF');
  const partner = await c.fixture('status-partner', 'PARTNER');
  const distributor = await c.fixture('status-distributor', 'DISTRIBUTOR');
  const member = await c.fixture('status-distributor-staff', 'DISTRIBUTOR', distributor.orgId, 'STAFF');
  const pending = await c.fixture('status-distributor-pending', 'DISTRIBUTOR', distributor.orgId, 'STAFF', 'PENDING');
  const other = await c.fixture('status-other-distributor', 'DISTRIBUTOR');
  const endpoint = `/api/network/distributors/${distributor.orgId}/status`;
  const status = (id: string, actor: any, active: boolean, expected: number | number[] = 200) => hit(id, actor, 'PATCH', endpoint, { isActive: active }, expected);
  const memberships = () => c.prisma.membership.findMany({ where: { organizationId: distributor.orgId }, orderBy: { id: 'asc' } });
  const beforeMembers = JSON.stringify(await memberships());
  const users = () => c.prisma.user.findMany({ where: { membership: { organizationId: distributor.orgId } }, orderBy: { id: 'asc' } });
  const beforeUsers = JSON.stringify(await users());
  const sessions = () => c.prisma.refreshToken.findMany({ where: { user: { membership: { organizationId: distributor.orgId } } }, orderBy: { id: 'asc' } });
  const beforeSessions = await sessions();
  const organizationProfile = async () => {
    const { isActive, accessVersion, updatedAt, ...profile } = await c.prisma.organization.findUniqueOrThrow({ where: { id: distributor.orgId } });
    return JSON.stringify(profile);
  };
  const beforeProfile = await organizationProfile();
  const connection = await c.connect('status-network', company, distributor);
  const agreement = await c.agreement('status-agreement', company, distributor, connection);
  await hit('status-stock', company, 'POST', '/api/kiosks/batch', { count: 1, model: 'Status retained model' }, 201);
  const order = await c.order('status-order', company, 'ALLOCATION', distributor, 1);
  await c.finishOrder('status-delivery', company, order);
  const business = async () => JSON.stringify({
    kiosks: await c.prisma.kiosk.findMany({ where: { currentOrgId: distributor.orgId } }),
    assignments: await c.prisma.kioskAssignment.findMany({ where: { organizationId: distributor.orgId } }),
    agreement: await c.prisma.agreement.findUnique({ where: { id: agreement.id } }),
    network: await c.prisma.networkConnection.findUnique({ where: { id: connection.id } }),
    order: await c.prisma.order.findUnique({ where: { id: order.id } }),
  });
  const beforeBusiness = await business();
  const listed = (await hit('status-initial-list', company, 'GET', '/api/network/distributors')).data.data.distributors;
  check('status-default-active', listed.every((d: any) => d.isActive && d.statusManagementAvailable));
  for (const actor of [null, manager, staff, distributor, member, partner]) {
    await status(`status-denied-${actor?.label ?? 'anonymous'}`, actor, false, actor ? 403 : 401);
  }
  for (const id of [company.orgId, partner.orgId, randomUUID()]) {
    await hit('status-non-distributor-' + id, company, 'PATCH', `/api/network/distributors/${id}/status`, { isActive: false }, 404);
  }
  await hit('status-invalid-id', company, 'PATCH', '/api/network/distributors/invalid/status', { isActive: false }, 400);
  for (const body of [{}, { isActive: 'false' }, { isActive: null }, { isActive: true, type: 'COMPANY' }]) {
    await hit('status-invalid-body-' + c.next(), company, 'PATCH', endpoint, body, 400);
  }
  await status('status-company-deactivates', company, false);
  await status('status-idempotent-deactivate', company, false);
  const deactivated = await c.prisma.organization.findUnique({ where: { id: distributor.orgId } });
  check('status-disabled-version-once', !deactivated.isActive && deactivated.accessVersion === 1);
  const afterSessions = await sessions();
  check('status-all-refresh-sessions-revoked', afterSessions.every((session: any) => session.revoked));
  check('status-session-records-retained', JSON.stringify(afterSessions) === JSON.stringify(beforeSessions.map((session: any) => ({ ...session, revoked: true }))));
  check('status-user-records-retained', JSON.stringify(await users()) === beforeUsers);
  check('status-organization-profile-retained', await organizationProfile() === beforeProfile);
  for (const actor of [distributor, member, pending]) {
    const blocked = await hit('status-login-blocked-' + actor.label, null, 'POST', '/api/auth/login', { email: actor.email, password: c.password }, 403);
    check('status-login-no-cookies-' + actor.label, !blocked.cookies);
    await hit('status-old-session-blocked-' + actor.label, actor, 'GET', '/api/auth/me', undefined, 403);
  }
  await hit('status-wrong-password-generic', null, 'POST', '/api/auth/login', { email: distributor.email, password: 'wrong-password' }, 401);
  await hit('status-old-refresh-blocked', distributor, 'POST', '/api/auth/refresh', undefined, 401);
  await hit('status-api-blocked', distributor, 'GET', '/api/kiosks', undefined, 403);
  await status('status-self-reactivation-denied', distributor, true, 403);
  await hit('status-other-unaffected', other, 'GET', '/api/auth/me');
  await hit('status-inactive-can-logout', distributor, 'POST', '/api/auth/refresh/logout');
  check('status-memberships-preserved', JSON.stringify(await memberships()) === beforeMembers);
  check('status-business-history-preserved', await business() === beforeBusiness);
  await status('status-company-admin-reactivates', admin, true);
  await hit('status-old-access-stays-revoked', distributor, 'GET', '/api/auth/me', undefined, 401);
  await hit('status-old-refresh-stays-revoked', distributor, 'POST', '/api/auth/refresh', undefined, 401);
  let fresh = await c.login('status-fresh', distributor.email);
  await hit('status-reactivated-me', fresh, 'GET', '/api/auth/me');
  await hit('status-reactivated-kiosks', fresh, 'GET', '/api/kiosks');
  const refreshed = await hit('status-reactivated-refresh', fresh, 'POST', '/api/auth/refresh');
  fresh = { ...fresh, cookie: refreshed.cookies };
  for (const mode of ['login', 'refresh']) {
    await Promise.all([
      status('status-race-deactivate-' + mode, company, false),
      hit('status-race-' + mode, mode === 'login' ? null : fresh, 'POST', `/api/auth/${mode}`, mode === 'login' ? { email: distributor.email, password: c.password } : undefined, [200, 401, 403]),
    ]);
    check('status-race-no-surviving-refresh-' + mode, await c.prisma.refreshToken.count({ where: { userId: distributor.userId, revoked: false } }) === 0);
    await hit('status-race-access-blocked-' + mode, fresh, 'GET', '/api/auth/me', undefined, 403);
    await status('status-race-reactivate-' + mode, company, true);
    fresh = await c.login('status-after-race-' + mode, distributor.email);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
    const customer = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
    let viewer = company;
    let sequence = 0;
    await page.route('**/api/**', async (route: any) => {
      const req = route.request();
      const u = new URL(req.url());
      const response = await c.http('status-company-ui-' + (++sequence), viewer, req.method(), u.pathname + u.search, req.postDataJSON() ?? undefined);
      await route.fulfill({ status: response.status, json: response.data });
    });
    await customer.route('**/api/**', async (route: any) => {
      const req = route.request();
      const u = new URL(req.url());
      const response = await c.http('status-distributor-ui-' + (++sequence), fresh, req.method(), u.pathname + u.search, req.postDataJSON() ?? undefined);
      await route.fulfill({ status: response.status, json: response.data });
    });
    await page.goto('http://localhost:3000/distributors', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Deactivate status-distributor', exact: true }).waitFor();
    await customer.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await customer.getByRole('heading', { name: 'Fleet composition', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Deactivate status-distributor', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    check('status-ui-cancel-preserves-active', (await c.prisma.organization.findUnique({ where: { id: distributor.orgId } })).isActive);
    await page.getByRole('button', { name: 'Deactivate status-distributor', exact: true }).click();
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await page.getByRole('button', { name: 'Activate status-distributor', exact: true }).waitFor();
    const row = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'Activate status-distributor', exact: true }) });
    check('status-ui-inactive-badge', await row.getByText('Inactive', { exact: true }).count() === 1);
    await page.screenshot({ path: path.join(c.outDir, 'distributor-inactive-light.png'), fullPage: true, animations: 'disabled' });
    // Existing open Distributor dashboard must leave on its identity polling cycle.
    await customer.waitForURL('**/login', { timeout: 45000 });
    check('status-open-dashboard-redirected', new URL(customer.url()).pathname === '/login');
    await customer.getByLabel('Email', { exact: true }).fill(distributor.email);
    await customer.getByLabel('Password', { exact: true }).fill(c.password);
    await customer.getByRole('button', { name: 'Sign in', exact: true }).click();
    await customer.getByText('Your distributor account is inactive. Contact the Company to reactivate it.', { exact: true }).waitFor();
    await customer.screenshot({ path: path.join(c.outDir, 'inactive-login.png'), fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.screenshot({ path: path.join(c.outDir, 'distributor-inactive-dark.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Activate status-distributor', exact: true }).click();
    const box = await page.getByRole('dialog').boundingBox();
    check('status-mobile-dialog-fits', box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: path.join(c.outDir, 'activate-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await page.getByRole('button', { name: 'Deactivate status-distributor', exact: true }).waitFor();
    fresh = await c.login('status-browser-reactivated', distributor.email);
    await customer.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await customer.getByRole('heading', { name: 'Fleet composition', exact: true }).waitFor();
    check('status-browser-reactivation-access', new URL(customer.url()).pathname === '/');
    viewer = staff;
    await page.reload({ waitUntil: 'networkidle' });
    check('status-company-staff-no-controls', await page.getByRole('button', { name: /^(Activate|Deactivate) / }).count() === 0);
    viewer = distributor;
    // Use a current session to prove the organization gate, rather than an expired token.
    viewer = fresh;
    await page.reload({ waitUntil: 'networkidle' });
    check('status-distributor-no-controls', await page.getByRole('button', { name: /^(Activate|Deactivate) / }).count() === 0);
  } finally { await browser.close(); }

  // Verify the narrow migration independently of earlier lifecycle migrations:
  // roll it back only in this disposable database, test legacy reads, then apply it.
  await c.sql.query('ALTER TABLE "Organization" DROP COLUMN "isActive", DROP COLUMN "accessVersion"');
  await hit('status-legacy-company-login', null, 'POST', '/api/auth/login', { email: company.email, password: c.password });
  const legacy = (await hit('status-legacy-list', company, 'GET', '/api/network/distributors')).data.data.distributors;
  check('status-legacy-controls-unavailable', legacy.every((d: any) => d.isActive && !d.statusManagementAvailable));
  await status('status-legacy-write-refused', company, false, 503);
  const migration = path.resolve(import.meta.dirname, '../../../../apps/api/prisma/migrations/20260929123000_distributor_access_status/migration.sql');
  await c.sql.query(fs.readFileSync(migration, 'utf8'));
  check('status-additive-migration-keeps-existing-active', (await c.prisma.organization.findMany()).every((o: any) => o.isActive && o.accessVersion === 0));
  check('status-business-records-still-preserved', await business() === beforeBusiness);
}
