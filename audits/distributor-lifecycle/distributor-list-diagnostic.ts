// Read-only diagnosis of the configured application's Distributor listing.
// Creates no accounts/sessions and never logs tokens or personal records.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const { prisma } = await import('../../apps/api/src/utils/db');
try {
  const membership = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const columns = await tx.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Organization' AND column_name IN ('gstNumber','phone','country') ORDER BY column_name`;
    console.log(JSON.stringify({ organizationProfileColumns: columns.map(row => row.column_name) }));
    return tx.membership.findFirstOrThrow({ where: { role: 'OWNER', status: 'ACTIVE', organization: { type: 'COMPANY' } }, select: { userId: true } });
  }, { maxWait: 20000, timeout: 20000 });
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.organization.findMany({ where: { type: 'DISTRIBUTOR' }, select: { id: true, gstNumber: true, phone: true, country: true }, take: 1 });
    }, { maxWait: 20000, timeout: 20000 });
    console.log(JSON.stringify({ profileQuery: 'passed' }));
  } catch (error: any) {
    console.log(JSON.stringify({ profileQuery: 'failed', code: error.code, model: error.meta?.modelName, column: error.meta?.column, cause: error.meta?.driverAdapterError?.cause }));
  }
  // Short-lived token for this read-only check; no login/refresh-token writes.
  const token = jwt.sign({ id: membership.userId }, process.env.ACCESS_SECRET_TOKEN!, { expiresIn: '2m' });
  for (const port of [4000, 3000]) {
    const response = await fetch(`http://localhost:${port}/api/network/distributors`, { headers: { Cookie: `access_token=${token}` }, signal: AbortSignal.timeout(15000) });
    const data: any = await response.json();
    console.log(JSON.stringify({ port, status: response.status, message: data.message, distributorCount: data.data?.distributors?.length }));
  }
  if (process.env.DIAG_BROWSER === '1') {
    const require = createRequire(import.meta.url);
    const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      await context.addCookies([{ name: 'access_token', value: token, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Strict' }]);
      const page = await context.newPage();
      const requests: { path: string; status: number }[] = [];
      await page.route('**/api/**', (route: any) => route.request().method() === 'GET' ? route.continue() : route.abort());
      page.on('response', (response: any) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, status: response.status() });
      });
      await page.goto('http://localhost:3000/distributors', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Distributors', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0 || document.body.innerText.includes('No distributors yet.') || document.body.innerText.includes('No distributors to show.'));
      if (await page.getByText("Couldn't load distributors.", { exact: true }).count()) throw new Error('Distributor error state remains visible');
      console.log(JSON.stringify({ browser: 'passed', distributorRows: await page.locator('tbody tr').count(), requests }));
      await page.screenshot({ path: path.join(os.tmpdir(), 'codex-kiosk-pagination-check/live-distributors-restored.png'), fullPage: true, animations: 'disabled' });
    } finally { await browser.close(); }
  }
} finally {
  await prisma.$disconnect();
}
