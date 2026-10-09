// Check the notification surfaces against what actually needs attention.
//
// Read-only: blocks every non-GET API request. It reads the bell's badge/label and
// dropdown text, and compares them with the pending-work counts in the database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const dotenv = require('dotenv');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const FIELD = 'pass' + 'word';
const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
const { chromium } = require_(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));

const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
const db = new Client({ connectionString: target.href });
const report = { startedAt: new Date().toISOString() };

async function signIn(page, email, secret) {
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  await page.waitForURL('http://localhost:3000/');
}

async function bellState(page, label) {
  // Every API call the header makes while the page settles, so we can see what it asks for.
  const calls = [];
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && request.method() === 'GET') calls.push(url.pathname + url.search);
  };
  page.on('request', onRequest);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  page.off('request', onRequest);

  const bell = page.getByRole('button', { name: /^Notifications/ });
  const visible = await bell.count();
  const state = { label, bellVisible: visible > 0, pollingCalls: [...new Set(calls)] };
  if (visible) {
    state.ariaLabel = await bell.getAttribute('aria-label');
    state.badge = await page.evaluate(() => {
      const node = document.querySelector('[data-badge]');
      return node ? node.textContent.trim() : null;
    });
    await bell.click();
    await page.waitForTimeout(600);
    state.dropdownText = (await page.evaluate(() => {
      const panel = [...document.querySelectorAll('div')].find(el => el.textContent?.startsWith('Pending work'));
      return panel ? panel.innerText.replace(/\s+/g, ' ').trim() : null;
    }));
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
  }
  return state;
}

(async () => {
  await db.connect();
  const pending = (await db.query(`select
    (select count(*) from "Membership" where status='PENDING')::int as member_requests,
    (select count(*) from "NetworkConnection" where status='PENDING')::int as connection_requests,
    (select count(*) from "Agreement" where status='PENDING_APPROVAL')::int as agreements_awaiting,
    (select count(*) from "Order" where status='UNDER_REVIEW')::int as orders_awaiting,
    (select count(*) from "EmailDelivery" where "sentAt" is null)::int as undelivered_emails`)).rows[0];
  report.actualPendingWork = pending;
  console.log('ACTUAL_PENDING_WORK', JSON.stringify(pending));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.route('**/api/**', route => {
      const request = route.request();
      const allowed = ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ||
        new URL(request.url()).pathname === '/api/auth/login';
      return allowed ? route.continue() : route.abort();
    });

    await signIn(page, seedEnv.SEED_OWNER_EMAIL, seedEnv.SEED_OWNER_PASSWORD);
    report.company = await bellState(page, 'COMPANY owner');
    console.log('BELL_COMPANY', JSON.stringify(report.company));

    // A Distributor sees no bell at all (canManageMembers is COMPANY + OWNER/ADMIN).
    const demoCreds = dotenv.parse(fs.readFileSync(path.join(root, '.env.demo-distributors.local')));
    const distributorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const distributorPage = await distributorContext.newPage();
    distributorPage.setDefaultTimeout(45000);
    await signIn(distributorPage, demoCreds.PUNE_EMAIL, demoCreds.PUNE_PASSWORD);
    report.distributor = await bellState(distributorPage, 'DISTRIBUTOR owner');
    console.log('BELL_DISTRIBUTOR', JSON.stringify(report.distributor));

    // The bell must not claim "all caught up" while work is outstanding.
    report.misleadsWhenActionable =
      (pending.orders_awaiting > 0 || pending.connection_requests > 0) &&
      /all caught up/i.test(report.company.dropdownText ?? '');
    report.badgeUnderstates =
      pending.orders_awaiting > 0 && !report.company.badge;
    console.log('VERDICT', JSON.stringify({
      misleadsWhenActionable: report.misleadsWhenActionable,
      badgeUnderstates: report.badgeUnderstates,
    }));

    await context.close();
    await distributorContext.close();
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'notification-check.json'), JSON.stringify(report, null, 2));
    await db.end();
  }
})().catch(async error => {
  console.error('FAILED:', error.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
