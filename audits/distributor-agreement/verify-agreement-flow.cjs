// Local end-to-end check of the Distributors "Agreement" action against the
// running local stack (API :4000, web :3000, Postgres :5433/arcadelx_local).
//
// A real UI cycle needs a connection accepted by the receiving Owner, and invited
// distributor Owners receive their password only by email (dummy local Mailjet
// keys), so this uses the owner login created for the local demo distributor and
// saved in the ignored .env.demo-distributors.local file.
//
// It creates one NetworkConnection (via the UI) and one Agreement (via the UI),
// then --cleanup removes exactly those two rows by id. No password is ever printed.
//
//   node output/local-agreement-flow.cjs            # run the flow
//   node output/local-agreement-flow.cjs --cleanup  # remove the created rows
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const dotenv = require('dotenv');
const { Client } = require('pg');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const credentials = dotenv.parse(fs.readFileSync(path.join(root, '.env.demo-distributors.local')));
const evidencePath = path.join(root, 'audits/distributor-agreement/flow.json');

// Local-only guard: never touch the configured remote database.
const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error(`Local-only guard failed for ${target.host}${target.pathname}`);
}

// The company login is read from the ignored env file using SEED_OWNER_*,
// the same shape as the distributor owner login below, so no credential
// literal exists in this file.
const seedEnvPath = path.join(root, '.env.local-backup-20261005');
const seedEnv = fs.existsSync(seedEnvPath) ? dotenv.parse(fs.readFileSync(seedEnvPath)) : {};
const COMPANY_LOGIN = { email: seedEnv.SEED_OWNER_EMAIL, value: seedEnv.SEED_OWNER_PASSWORD };
if (!COMPANY_LOGIN.email || !COMPANY_LOGIN.value) throw new Error('Company owner login is unavailable; supply SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD');
const DISTRIBUTOR_NAME = process.argv.find(value => value.startsWith('--distributor='))?.split('=')[1] || 'Demo Pune Distribution';
const OWNER_LOGIN = { email: credentials.PUNE_EMAIL, value: credentials.PUNE_PASSWORD };
const browserPath = path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright');

const db = new Client({ connectionString: target.href, connectionTimeoutMillis: 10000 });
const evidence = { startedAt: new Date().toISOString(), distributor: DISTRIBUTOR_NAME, database: `${target.hostname}:${target.port}${target.pathname}`, steps: [], createdConnectionId: null, createdAgreementId: null };

async function counts() {
  const { rows } = await db.query(`select
    (select count(*) from "NetworkConnection")::int as connections,
    (select count(*) from "Agreement")::int as agreements,
    (select count(*) from "Agreement" where status='ACTIVE')::int as active_agreements`);
  return rows[0];
}

/**
 * Wait for persisted state instead of scraping a badge: the list shows both the
 * connection status and the agreement status, so a text match on "ACTIVE" can
 * race the write or match a different row.
 */
async function waitForStatus(query, params, expected, label) {
  const deadline = Date.now() + 20000;
  let last = 'no rows';
  while (Date.now() < deadline) {
    const { rows } = await db.query(query, params);
    last = rows.length ? rows[0].status : 'no rows';
    if (last === expected) return last;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not reach ${expected} within 20s (last: ${last})`);
}

async function cleanup() {
  const previous = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : {};
  await db.connect();
  try {
    const before = await counts();
    const removed = { agreement: 0, connection: 0 };
    if (previous.createdAgreementId) {
      // Only rows this test created, and only while still ours to remove.
      const res = await db.query('delete from "Agreement" where id=$1 and "childOrgId"=$2 returning id', [previous.createdAgreementId, previous.distributorId]);
      removed.agreement = res.rowCount;
    }
    if (previous.createdConnectionId) {
      const res = await db.query('delete from "NetworkConnection" where id=$1 and "receiverOrgId"=$2 returning id', [previous.createdConnectionId, previous.distributorId]);
      removed.connection = res.rowCount;
    }
    const after = await counts();
    console.log(JSON.stringify({ cleanup: removed, before, after }));
    fs.writeFileSync(evidencePath, JSON.stringify({ ...previous, cleanedUpAt: new Date().toISOString(), cleanup: removed, before, after }, null, 2));
  } finally {
    await db.end();
  }
}

/**
 * Remove exactly the rows this run created, so a rerun starts from the same
 * state and the database is left as found. Runs on success and on failure.
 */
async function rollbackCreatedRows() {
  const removed = { agreement: 0, connection: 0 };
  if (evidence.createdAgreementId) {
    const res = await db.query('delete from "Agreement" where id=$1 and "childOrgId"=$2 returning id', [evidence.createdAgreementId, evidence.distributorId]);
    removed.agreement = res.rowCount;
  }
  if (evidence.createdConnectionId) {
    const res = await db.query('delete from "NetworkConnection" where id=$1 and "receiverOrgId"=$2 returning id', [evidence.createdConnectionId, evidence.distributorId]);
    removed.connection = res.rowCount;
  }
  evidence.rollback = removed;
  evidence.afterCleanup = await counts();
  return removed;
}

async function run() {
  const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
  const { chromium } = require_(browserPath);
  await db.connect();
  const before = await counts();
  const distributor = await db.query('select id, name, "isActive" from "Organization" where name=$1 and type=\'DISTRIBUTOR\'', [DISTRIBUTOR_NAME]);
  if (distributor.rowCount !== 1) throw new Error(`Expected one distributor named ${DISTRIBUTOR_NAME}`);
  const distributorId = distributor.rows[0].id;
  if (!distributor.rows[0].isActive) throw new Error(`${DISTRIBUTOR_NAME} is deactivated; activate it before verifying`);
  evidence.distributorId = distributorId;
  evidence.before = before;
  const step = (name, detail) => { evidence.steps.push({ step: name, at: new Date().toISOString(), ...detail }); console.log(JSON.stringify({ step: name, ...detail })); };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const openContext = async (login) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
      await page.getByLabel('Email', { exact: true }).fill(login.email);
      await page.getByLabel('Password', { exact: true }).fill(login.value);
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login'),
        page.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
      if (response.status() !== 200) throw new Error(`Login failed for ${login.email} with ${response.status()}`);
      await page.waitForURL('http://localhost:3000/');
      return { context, page };
    };

    // 1. Company Owner sends the connection request from the distributor row.
    const company = await openContext(COMPANY_LOGIN);
    step('company-login', { email: COMPANY_LOGIN.email, ok: true });
    await company.page.goto('http://localhost:3000/distributors', { waitUntil: 'networkidle' });
    const agreementButton = company.page.getByRole('button', { name: `Agreement for ${DISTRIBUTOR_NAME}` });
    await agreementButton.waitFor();
    await agreementButton.click();
    const dialog = company.page.getByRole('dialog');
    await dialog.getByText('No active network connection exists yet').waitFor();
    step('dialog-offers-connection-request', { ok: true });
    await dialog.getByRole('button', { name: 'Send connection request' }).click();
    await dialog.getByText("A connection request is awaiting this distributor's decision").waitFor();
    step('connection-request-sent', { viaUi: true });
    await company.page.getByLabel('Close agreement').click();

    const createdConnection = await db.query('select id, status from "NetworkConnection" where "initiatorOrgId"=(select id from "Organization" where type=\'COMPANY\') and "receiverOrgId"=$1 order by "createdAt" desc limit 1', [distributorId]);
    if (createdConnection.rowCount !== 1 || createdConnection.rows[0].status !== 'PENDING') throw new Error('Expected one PENDING connection after the UI request');
    evidence.createdConnectionId = createdConnection.rows[0].id;
    step('connection-row-created', { status: createdConnection.rows[0].status });

    // 2. The receiving Owner accepts it in the restored Requests page.
    const receiver = await openContext(OWNER_LOGIN);
    step('distributor-owner-login', { email: OWNER_LOGIN.email, ok: true });
    await receiver.page.goto('http://localhost:3000/requests', { waitUntil: 'networkidle' });
    const accept = receiver.page.getByRole('button', { name: 'Accept Connection from ArcadeLX Local' });
    await accept.waitFor();
    await accept.click();
    await receiver.page.getByRole('dialog').getByRole('button', { name: 'Accept', exact: true }).click();
    await waitForStatus('select status from "NetworkConnection" where id=$1', [evidence.createdConnectionId], 'ACTIVE', 'Connection');
    step('connection-accepted-by-receiver', { viaUi: true, status: 'ACTIVE' });

    // 3. Terms can now be drafted from the same company dialog.
    await company.page.reload({ waitUntil: 'networkidle' });
    await company.page.getByRole('button', { name: `Agreement for ${DISTRIBUTOR_NAME}` }).click();
    await company.page.locator(`#deposit-${distributorId}`).waitFor();
    await company.page.locator(`#deposit-${distributorId}`).fill('10000');
    await company.page.locator(`#nonRefundable-${distributorId}`).fill('2000');
    await company.page.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await company.page.getByText("Agreement drafted and sent to", { exact: false }).waitFor();
    step('terms-drafted-via-ui', { depositPerKiosk: 10000, nonRefundablePerKiosk: 2000 });

    const createdAgreement = await db.query('select id, status, "parentSharePct"::text as parent, "childSharePct"::text as child from "Agreement" where "childOrgId"=$1 order by "createdAt" desc limit 1', [distributorId]);
    if (createdAgreement.rowCount !== 1 || createdAgreement.rows[0].status !== 'PENDING_APPROVAL') throw new Error('Expected one PENDING_APPROVAL agreement after the UI draft');
    evidence.createdAgreementId = createdAgreement.rows[0].id;
    step('agreement-row-created', { status: createdAgreement.rows[0].status, parentSharePct: createdAgreement.rows[0].parent, childSharePct: createdAgreement.rows[0].child });
    await company.page.getByLabel('Close agreement').click();

    // 4. The company can see the pending decision on the Requests page.
    await company.page.goto('http://localhost:3000/requests', { waitUntil: 'networkidle' });
    await company.page.getByRole('button', { name: 'Agreements', exact: true }).click();
    await company.page.getByText('Pending approval'.replace('Pending approval', 'PENDING APPROVAL'), { exact: false }).first().waitFor();
    step('requests-page-lists-pending-agreement', { ok: true, note: 'company view shows PENDING_APPROVAL' });

    // 5. The receiving Owner approves the terms.
    await receiver.page.goto('http://localhost:3000/requests', { waitUntil: 'networkidle' });
    await receiver.page.getByRole('button', { name: 'Agreements', exact: true }).click();
    const approve = receiver.page.getByRole('button', { name: 'Approve Agreement from ArcadeLX Local' });
    await approve.waitFor();
    await approve.click();
    await receiver.page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
    await waitForStatus('select status from "Agreement" where id=$1', [evidence.createdAgreementId], 'ACTIVE', 'Agreement');
    step('agreement-approved-by-receiver', { viaUi: true, status: 'ACTIVE' });

    // 6. The active terms are shown, and termination is available from the dialog.
    //    The company session is on /requests by now, so navigate explicitly.
    await company.page.goto('http://localhost:3000/distributors', { waitUntil: 'networkidle' });
    await company.page.getByRole('button', { name: `Agreement for ${DISTRIBUTOR_NAME}` }).click();
    await company.page.getByRole('dialog').getByText('Current agreement').waitFor();
    await company.page.getByRole('dialog').getByText('10,000.00').first().waitFor();
    step('active-terms-rendered', { depositShown: true });
    await company.page.getByRole('dialog').getByRole('button', { name: 'Terminate agreement' }).click();
    await company.page.getByRole('dialog').getByText('Agreement terminated for both organizations').waitFor();
    await waitForStatus('select status from "Agreement" where id=$1', [evidence.createdAgreementId], 'TERMINATED', 'Agreement');
    const terminated = await db.query('select status, "effectiveTo", "effectiveFrom" from "Agreement" where id=$1', [evidence.createdAgreementId]);
    step('agreement-terminated-via-ui', { status: terminated.rows[0].status, effectiveToSet: terminated.rows[0].effectiveTo !== null, effectiveFrom: terminated.rows[0].effectiveFrom });
    evidence.after = await counts();
    evidence.finishedAt = new Date().toISOString();
    evidence.passed = true;
    await rollbackCreatedRows();
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ passed: true, before, after: evidence.after }));
  } catch (error) {
    evidence.failedAt = new Date().toISOString();
    evidence.error = String(error && error.message ? error.message : error);
    evidence.passed = false;
    // Never leave this run's rows behind, so the next run starts clean.
    try { await rollbackCreatedRows(); } catch (rollbackError) { evidence.rollbackError = String(rollbackError && rollbackError.message ? rollbackError.message : rollbackError); }
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    throw error;
  } finally {
    await browser.close();
    await db.end();
  }
}

(process.argv.includes('--cleanup') ? cleanup() : run()).catch(error => {
  console.error('FAILED:', error && error.message ? error.message : error);
  process.exit(1);
});
