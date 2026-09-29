// Explicitly requested running-app test login. Default is read-only preflight.
// --create adds one User and one ACTIVE ADMIN Membership to the existing target.
// Never resets an existing password, creates a duplicate organization or sends mail.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const { prisma } = await import('../../apps/api/src/utils/db');
const organizationId = '67abc491-0fec-4385-a8b9-ed95c4b94f08';
const organizationName = 'Test Distributor Pvt Ltf';
const email = 'distributor.test@example.com';
const verifyExisting = process.argv.includes('--verify-existing');
try {
  const before = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, name: true, type: true, ownerId: true, memberships: { select: { userId: true, role: true, status: true } }, _count: { select: { kiosks: true } } },
    });
    assert.equal(organization.name, organizationName);
    assert.equal(organization.type, 'DISTRIBUTOR');
    assert(organization.memberships.some(member => member.userId === organization.ownerId && member.role === 'OWNER' && member.status === 'ACTIVE'));
    assert.equal(await tx.user.count({ where: { email } }), verifyExisting ? 1 : 0, 'Existing accounts must only be verified, never overwritten');
    return organization;
  }, { maxWait: 20000, timeout: 20000 });
  console.log(JSON.stringify({ preflight: 'passed', organizationId, organizationName, existingOwnerPreserved: true, existingMemberships: before.memberships.length, kioskCount: before._count.kiosks, newLoginEmail: email, newRole: 'ADMIN' }));
  if (process.argv.includes('--create') || verifyExisting) {
    const password = verifyExisting ? process.env.DISTRIBUTOR_TEST_PASSWORD : crypto.randomBytes(12).toString('base64url') + 'aA7!';
    assert(password, 'Supply the previously created password in DISTRIBUTOR_TEST_PASSWORD for verification');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = verifyExisting ? await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true } }) : await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
      const target = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, type: true, ownerId: true } });
      assert.equal(target.name, organizationName);
      assert.equal(target.type, 'DISTRIBUTOR');
      assert.equal(target.ownerId, before.ownerId);
      const created = await tx.user.create({ data: { name: 'Distributor Test Login', email, passwordHash }, select: { id: true, email: true } });
      await tx.membership.create({ data: { userId: created.id, organizationId, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
      return created;
    }, { maxWait: 20000, timeout: 20000 });
    // Deliver the newly requested credential only to the caller. Never persist
    // plaintext in source, evidence files, screenshots, or redirected test logs.
    if (!verifyExisting) console.log(JSON.stringify({ created: true, loginUrl: 'http://localhost:3000/login', organizationName, email, password, role: 'ADMIN', userId: user.id }));
    const outputDir = path.join(root, 'audits/distributor-lifecycle/distributor-test-login');
    fs.mkdirSync(outputDir, { recursive: true });
    const require = createRequire(import.meta.url);
    const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      const requests: { method: string; path: string; status: number }[] = [];
      await page.route('**/api/**', (route: any) => {
        const request = route.request();
        const allowed = request.method() === 'GET' || (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login');
        return allowed ? route.continue() : route.abort();
      });
      page.on('response', (response: any) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/')) {
          const result = { method: response.request().method(), path: url.pathname, status: response.status() };
          requests.push(result);
          console.log(JSON.stringify(result));
        }
      });
      await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      const [loginResponse] = await Promise.all([
        page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/auth/login'),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
      assert.equal(loginResponse.status(), 200);
      await page.waitForURL('http://localhost:3000/');
      await page.getByText(organizationName, { exact: true }).waitFor();
      const meResponse = await context.request.get('http://localhost:3000/api/auth/me');
      assert.equal(meResponse.status(), 200);
      const me = (await meResponse.json()).data.user;
      assert.equal(me.id, user.id);
      assert.equal(me.membership.organizationId, organizationId);
      assert.equal(me.membership.organization.type, 'DISTRIBUTOR');
      assert.equal(me.membership.status, 'ACTIVE');
      assert.equal(me.membership.role, 'ADMIN');
      const inventoryResponse = await context.request.get('http://localhost:3000/api/kiosks');
      assert.equal(inventoryResponse.status(), 200);
      const kiosks = (await inventoryResponse.json()).data.kiosks;
      assert(kiosks.every((kiosk: any) => kiosk.currentOrgId === organizationId));
      await page.screenshot({ path: path.join(outputDir, 'distributor-dashboard.png'), fullPage: true, animations: 'disabled' });
      await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
      if (kiosks.length === 0) await page.getByText('No machines in your inventory.', { exact: true }).waitFor();
      else await page.locator('tbody tr').first().waitFor();
      await page.screenshot({ path: path.join(outputDir, 'distributor-inventory.png'), fullPage: true, animations: 'disabled' });
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ownerId: true, _count: { select: { memberships: true, kiosks: true } } } });
      assert.equal(after.ownerId, before.ownerId);
      assert.equal(after._count.memberships, before.memberships.length + (verifyExisting ? 0 : 1));
      assert.equal(after._count.kiosks, before._count.kiosks);
      const result = { verifiedAt: new Date().toISOString(), userId: user.id, email, organizationId, organizationName, role: 'ADMIN', status: 'ACTIVE', browserLogin: 'passed', identity: 'passed', inventory: 'passed', kioskCount: kiosks.length, existingOwnerPreserved: true, externalEmailSent: false, requests };
      fs.writeFileSync(path.join(outputDir, 'verification.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
    } finally { await browser.close(); }
  }
} finally { await prisma.$disconnect(); }
