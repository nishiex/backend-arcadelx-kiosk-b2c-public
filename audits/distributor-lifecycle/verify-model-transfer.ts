import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
assert(process.env.DISTRIBUTOR_TEST_PASSWORD, 'Test-login password required in environment');
const outputDir = path.join(root, 'audits/distributor-lifecycle/running-model-transfer');
const proof = JSON.parse(fs.readFileSync(path.join(outputDir, 'result.json'), 'utf8'));
const { plan } = proof;
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks: string[] = [];
function check(name: string, pass: boolean) { assert(pass, name); checks.push(name); console.log('PASS ' + name); }
async function context() {
  const value = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  value.setDefaultTimeout(45000);
  await value.route('**/api/**', (route: any) => {
    const request = route.request();
    return request.method() === 'GET' || (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/login') ? route.continue() : route.abort();
  });
  return value;
}
async function dashboardTotal(page: any, count: number) {
  const total = page.locator('[data-reveal]').filter({ has: page.getByText('Total Kiosks', { exact: true }) }).locator('.tabular-nums');
  await total.getByText(String(count), { exact: true }).waitFor();
  return await total.innerText() === String(count);
}
try {
  const companyContext = await context();
  const token = jwt.sign({ id: plan.actingUserId }, process.env.ACCESS_SECRET_TOKEN!, { expiresIn: '5m' });
  await companyContext.addCookies([{ name: 'access_token', value: token, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Strict' }]);
  const company = await companyContext.newPage();
  await company.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
  await company.getByText(/of 127 machines/).waitFor();
  check('Company inventory count is 127', true);
  for (const kiosk of plan.kiosks) {
    await company.getByLabel('Search machines', { exact: true }).fill(kiosk.machineCode);
    await company.getByText('No machines match your filters.', { exact: true }).waitFor();
    check(`${kiosk.machineCode} absent from Company inventory`, await company.locator('tbody tr').count() === 0);
  }
  await company.getByLabel('Search machines', { exact: true }).fill('');
  await company.getByText(/of 127 machines/).waitFor();
  await company.screenshot({ path: path.join(outputDir, 'company-inventory-127.png'), fullPage: true, animations: 'disabled' });
  await company.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  check('Company dashboard total is 127', await dashboardTotal(company, 127));
  const recentCompany = company.locator('section').filter({ has: company.getByRole('heading', { name: 'Recent kiosks', exact: true }) });
  await recentCompany.locator('li').first().waitFor();
  const recentCodes = await recentCompany.locator('li .font-mono').allTextContents();
  check('Transferred kiosks absent from Company Recent kiosks', plan.kiosks.every((kiosk: any) => !recentCodes.includes(kiosk.machineCode)));
  await company.screenshot({ path: path.join(outputDir, 'company-dashboard-127.png'), fullPage: true, animations: 'disabled' });

  const distributorContext = await context();
  const distributor = await distributorContext.newPage();
  await distributor.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await distributor.getByLabel('Email', { exact: true }).fill('distributor.test@example.com');
  await distributor.getByLabel('Password', { exact: true }).fill(process.env.DISTRIBUTOR_TEST_PASSWORD);
  const [login] = await Promise.all([
    distributor.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/auth/login'),
    distributor.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  check('Distributor login succeeds', login.status() === 200);
  await distributor.waitForURL('http://localhost:3000/');
  await distributor.getByText(plan.distributorName, { exact: true }).waitFor();
  check('Distributor dashboard total is 3', await dashboardTotal(distributor, 3));
  await distributor.screenshot({ path: path.join(outputDir, 'distributor-dashboard-3.png'), fullPage: true, animations: 'disabled' });
  const api = await distributorContext.request.get('http://localhost:3000/api/kiosks');
  assert.equal(api.status(), 200);
  const inventory = (await api.json()).data.kiosks;
  check('API resolves all three kiosks to Distributor', inventory.length === 3 && inventory.every((row: any) => plan.kiosks.some((expected: any) => row.id === expected.id && row.model === expected.model) && row.currentOrgId === plan.distributorId && row.currentOrg?.name === plan.distributorName && row.assignedOrg?.id === plan.distributorId));
  await distributor.goto('http://localhost:3000/kiosks', { waitUntil: 'domcontentloaded' });
  await distributor.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
  const labels = await distributor.locator('tbody tr td:nth-child(3)').allTextContents();
  check('Distributor table labels all three assignments', labels.every((label: string) => label === plan.distributorName));
  const modelSelect = distributor.getByLabel('Model', { exact: true });
  check('All three model options are available', (await modelSelect.locator('option').count()) === 4);
  for (const kiosk of plan.kiosks) {
    await modelSelect.selectOption(kiosk.model);
    await distributor.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    check(`Model filter: ${kiosk.model}`, await distributor.locator('tbody tr td:first-child .font-mono').innerText() === kiosk.machineCode);
  }
  await modelSelect.selectOption('');
  await distributor.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
  await distributor.screenshot({ path: path.join(outputDir, 'distributor-three-models.png'), fullPage: true, animations: 'disabled' });
  const result = { verifiedAt: new Date().toISOString(), scope: 'Running frontend and real API; no mocked responses', checks, companyOwned: 127, distributorOwned: 3, kiosks: plan.kiosks };
  fs.writeFileSync(path.join(outputDir, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
