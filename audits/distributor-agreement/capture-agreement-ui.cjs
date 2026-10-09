// Read-only screenshots of the new Agreement UI against the running local stack.
// Opens the dialog and the Requests page but never submits a write.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const credentials = dotenv.parse(fs.readFileSync(path.join(root, '.env.demo-distributors.local')));
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const outDir = path.join(root, 'audits/distributor-agreement');
fs.mkdirSync(outDir, { recursive: true });

const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
const { chromium } = require_(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));

async function signIn(browser, login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email', { exact: true }).fill(login.email);
  await page.getByLabel('Password', { exact: true }).fill(login.value);
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  await page.waitForURL('http://localhost:3000/');
  return page;
}

(async () => {
  const shots = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const company = await signIn(browser, { email: seedEnv.SEED_OWNER_EMAIL, value: seedEnv.SEED_OWNER_PASSWORD });
    await company.goto('http://localhost:3000/distributors', { waitUntil: 'networkidle' });
    await company.getByRole('button', { name: 'Agreement for Demo Pune Distribution' }).waitFor();
    const table = path.join(outDir, 'distributors-agreement-column.png');
    await company.screenshot({ path: table, fullPage: true, animations: 'disabled' });
    shots.push(table);

    // Unconnected distributor: the dialog must offer the connection request.
    await company.getByRole('button', { name: 'Agreement for Demo Pune Distribution' }).click();
    const dialog = company.getByRole('dialog');
    await dialog.getByText('No active network connection exists yet').waitFor();
    const dialogShot = path.join(outDir, 'agreement-dialog-connection-required.png');
    await dialog.screenshot({ path: dialogShot, animations: 'disabled' });
    shots.push(dialogShot);
    await company.getByLabel('Close agreement').click();

    // Connected distributor with live terms: summary plus termination.
    await company.getByRole('button', { name: 'Agreement for Demo Pune Distributor' }).click();
    await company.getByRole('dialog').getByText('Current agreement').waitFor();
    const activeShot = path.join(outDir, 'agreement-dialog-active-terms.png');
    await company.getByRole('dialog').screenshot({ path: activeShot, animations: 'disabled' });
    shots.push(activeShot);
    await company.getByLabel('Close agreement').click();

    // The restored Requests page, where the receiving Owner decides.
    const receiver = await signIn(browser, { email: credentials.PUNE_EMAIL, value: credentials.PUNE_PASSWORD });
    await receiver.goto('http://localhost:3000/requests', { waitUntil: 'networkidle' });
    await receiver.getByRole('button', { name: 'Agreements', exact: true }).click();
    await receiver.waitForTimeout(1200);
    const requestsShot = path.join(outDir, 'requests-agreements.png');
    await receiver.screenshot({ path: requestsShot, fullPage: true, animations: 'disabled' });
    shots.push(requestsShot);

    console.log(JSON.stringify({ screenshots: shots.map(file => path.relative(root, file).replace(/\\/g, '/')), writesPerformed: false }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error('SCREENSHOTS FAILED:', error.message); process.exit(1); });
