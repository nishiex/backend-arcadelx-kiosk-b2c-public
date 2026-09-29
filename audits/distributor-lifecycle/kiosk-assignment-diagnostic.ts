// Real running API/browser check. Only reads the configured database and API.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const { prisma } = await import('../../apps/api/src/utils/db');
try {
  const membership = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.membership.findFirstOrThrow({ where: { role: 'OWNER', status: 'ACTIVE', organization: { type: 'COMPANY' } }, select: { userId: true } });
  }, { maxWait: 20000, timeout: 20000 });
  const token = jwt.sign({ id: membership.userId }, process.env.ACCESS_SECRET_TOKEN!, { expiresIn: '2m' });
  const response = await fetch('http://localhost:3000/api/kiosks', { headers: { Cookie: `access_token=${token}` }, signal: AbortSignal.timeout(20000) });
  const body: any = await response.json();
  assert.equal(response.status, 200);
  const kiosks = body.data.kiosks;
  assert(kiosks.every((kiosk: any) => (!kiosk.currentOrgId || kiosk.currentOrg?.id === kiosk.currentOrgId) && 'assignedOrg' in kiosk));
  const counts = kiosks.reduce((acc: Record<string, number>, kiosk: any) => {
    const type = kiosk.currentOrg?.type || 'NO_OWNER';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ status: response.status, totalKiosks: kiosks.length, countsByOwnerType: counts, assignedKiosks: kiosks.filter((kiosk: any) => kiosk.currentOrg?.type !== 'COMPANY' && kiosk.currentOrg).map((kiosk: any) => ({ machineCode: kiosk.machineCode, organization: kiosk.currentOrg.name })) }));
  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'access_token', value: token, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.route('**/api/**', (route: any) => route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Machines', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0 || document.body.innerText.includes('No machines yet.'));
    const rendered: { machineCode: string; assignedTo: string }[] = [];
    if (kiosks.length) {
      await page.getByLabel('Rows per page').selectOption('100');
      while (true) {
        const rows = page.locator('tbody tr');
        for (let i = 0; i < await rows.count(); i++) {
          const machineCode = await rows.nth(i).locator('td').nth(0).locator('.font-mono').innerText();
          const label = await rows.nth(i).locator('td').nth(2).innerText();
          const kiosk = kiosks.find((item: any) => item.machineCode === machineCode);
          assert(kiosk);
          if (kiosk.currentOrg?.type === 'COMPANY' && (!kiosk.assignedOrg || kiosk.assignedOrg.id === kiosk.currentOrgId)) assert.equal(label, 'Unassigned');
          else if (kiosk.currentOrg) assert(label.includes(kiosk.currentOrg.name));
          else assert.equal(label, 'Unassigned');
          assert(!label.includes('Unknown organization'));
          rendered.push({ machineCode, assignedTo: label });
        }
        const next = page.getByRole('button', { name: 'Next page', exact: true });
        if (await next.isDisabled()) break;
        await next.click();
      }
    }
    assert.equal(rendered.length, kiosks.length);
    await page.screenshot({ path: path.join(os.tmpdir(), 'codex-kiosk-pagination-check/live-kiosk-assignments.png'), fullPage: true, animations: 'disabled' });
    console.log(JSON.stringify({ browser: 'passed', checkedRows: rendered.length, labels: [...new Set(rendered.map(row => row.assignedTo))] }));
  } finally { await browser.close(); }
} finally { await prisma.$disconnect(); }
