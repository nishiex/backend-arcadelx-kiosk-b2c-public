// Real Distributor login/logout. One injected HTTP failure verifies retry UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

assert(process.env.DISTRIBUTOR_TEST_PASSWORD);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputDir = path.join(root, 'audits/distributor-lifecycle/logout-browser');
fs.mkdirSync(outputDir, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks: string[] = [];
const check = (name: string, pass: boolean) => { assert(pass, name); checks.push(name); console.log('PASS ' + name); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(45000);
  const page = await context.newPage();
  let injectFailure = true;
  let refreshCookieReceived = false;
  await page.route('**/api/**', async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/refresh/logout') {
      refreshCookieReceived = (await request.allHeaders()).cookie?.includes('refresh_token=') ?? false;
      if (injectFailure) return route.fulfill({ status: 503, json: { success: false, message: 'Injected logout failure' } });
    }
    if (request.method() === 'GET' || (request.method() === 'POST' && ['/api/auth/login', '/api/auth/refresh', '/api/auth/refresh/logout'].includes(url.pathname))) return route.continue();
    return route.abort();
  });
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email', { exact: true }).fill('distributor.test@example.com');
  await page.getByLabel('Password', { exact: true }).fill(process.env.DISTRIBUTOR_TEST_PASSWORD);
  const [login] = await Promise.all([
    page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/auth/login'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  check('Distributor login HTTP 200', login.status() === 200);
  await page.waitForURL('http://localhost:3000/');
  await page.getByText('Test Distributor Pvt Ltf', { exact: true }).waitFor();
  const before = await context.cookies();
  const refresh = before.find((cookie: any) => cookie.name === 'refresh_token');
  check('Existing refresh cookie has /api/auth/refresh path', refresh?.path === '/api/auth/refresh');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByText("Couldn't sign out. Please try again.", { exact: true }).waitFor();
  check('Failed logout stays on dashboard and enables retry', page.url() === 'http://localhost:3000/' && await page.getByRole('button', { name: 'Sign out', exact: true }).isEnabled());
  check('Failed logout retains valid session', (await context.request.get('http://localhost:3000/api/auth/me')).status() === 200);
  injectFailure = false;
  const [logout] = await Promise.all([
    page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/auth/refresh/logout'),
    page.getByRole('button', { name: 'Sign out', exact: true }).click(),
  ]);
  check('Logout HTTP 200 with current refresh cookie', logout.status() === 200 && refreshCookieReceived);
  await page.waitForURL('http://localhost:3000/login');
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  check('Both authentication cookies removed', !(await context.cookies()).some((cookie: any) => ['access_token', 'refresh_token'].includes(cookie.name)));
  check('Identity blocked after logout', (await context.request.get('http://localhost:3000/api/auth/me')).status() === 401);
  check('Kiosk API blocked after logout', (await context.request.get('http://localhost:3000/api/kiosks')).status() === 401);
  const replay = await fetch('http://localhost:3000/api/auth/refresh', { method: 'POST', headers: { Cookie: `refresh_token=${refresh.value}` }, signal: AbortSignal.timeout(20000) });
  check('Old refresh cookie cannot recreate session', replay.status === 401);
  check('Repeated logout is safe', (await context.request.post('http://localhost:3000/api/auth/refresh/logout')).status() === 200);
  await page.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/login(?:\?|$)/);
  check('Reopening protected page returns to login', new URL(page.url()).pathname === '/login');
  await page.screenshot({ path: path.join(outputDir, 'signed-out.png'), fullPage: true, animations: 'disabled' });
  const result = { verifiedAt: new Date().toISOString(), checks, transport: 'Real API/browser; first logout response intentionally replaced by 503 for retry check', applicationDataChanged: false };
  fs.writeFileSync(path.join(outputDir, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
