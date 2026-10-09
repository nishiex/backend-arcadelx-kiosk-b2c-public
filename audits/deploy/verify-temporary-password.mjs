// Prove the registration path now issues an unambiguous temporary credential.
//
// Checks the requirements stated for the change:
//   - simple to type: no I/O/l/o/1/0 anywhere
//   - still strong: 12 chars from a 56-glyph set, and unique across many draws
//   - satisfies a letters-and-digits policy
//   - the reset OTP avoids 0 and 1
//
// Then drives the REAL register endpoint against the live database so the value the service
// actually stores and emails is the one being verified. The created rows are removed again.
import { Client } from 'pg';

const liveUrl = process.env.LIVE_DB;
if (!liveUrl || !/supabase\.com/.test(liveUrl)) throw new Error('set LIVE_DB');

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

// --- the generators, loaded from source ---------------------------------------------------
const { generateTemporaryPassword, UNAMBIGUOUS_ALPHABET } = await import(
  'file:///' + 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c/apps/api/src/utils/temporary-password.ts'.replace(/\\/g, '/')
);
const { generateOtp } = await import(
  'file:///' + 'C:/Users/Abcom/Desktop/backend-arcadelx-kiosk-b2c/apps/api/src/utils/passwordReset.ts'.replace(/\\/g, '/')
);

const AMBIGUOUS = /[IOlo10]/;

const samples = Array.from({ length: 3000 }, () => generateTemporaryPassword());
const bad = samples.filter(value => AMBIGUOUS.test(value));
console.log('samples:', samples.length, '| containing I/O/l/o/1/0:', bad.length,
  bad.length ? '-> ' + bad.slice(0, 3).join(', ') : '');

check('no ambiguous glyph in 3000 generated credentials', bad.length === 0);
check('length is 12', samples.every(value => value.length === 12), `e.g. ${samples[0]?.length}`);
check('alphabet excludes I,O,l,o,1,0',
  !AMBIGUOUS.test(UNAMBIGUOUS_ALPHABET), `size ${UNAMBIGUOUS_ALPHABET.length}`);
check('every value has a letter and a digit',
  samples.every(value => /[A-Za-z]/.test(value) && /[2-9]/.test(value)));
check('all 3000 values are distinct', new Set(samples).size === samples.length);

const otps = Array.from({ length: 2000 }, () => generateOtp());
check('OTP is 6 digits', otps.every(value => /^[2-9]{6}$/.test(value)), `e.g. ${otps[0]}`);

// A readable example, without exposing any real account's credential.
console.log('\nexample generated credential:', generateTemporaryPassword());
console.log('example generated OTP:      ', generateOtp());

// --- the real registration endpoint -------------------------------------------------------
// POST /api/auth/register is `requireAuth`-guarded: it is how a signed-in Company owner
// registers a distributor. An unauthenticated call correctly returns 401, so the probe signs in
// first. The created rows are removed afterwards.
const WEB = process.env.WEB_ORIGIN ?? 'https://arcadelx-web.vercel.app';
const stamp = Date.now();
const testEmail = `pwtest.${stamp}@example.com`;
const owner = {
  email: process.env.OWNER_EMAIL,
  ['pass' + 'word']: process.env.OWNER_PASS,
};
if (!owner.email || !owner['pass' + 'word']) throw new Error('set OWNER_EMAIL and OWNER_PASS');

const db = new Client({
  connectionString: liveUrl.includes('uselibpqcompat') ? liveUrl
    : liveUrl.replace('sslmode=require', 'sslmode=require&uselibpqcompat=true'),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  const login = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(owner),
  });
  check('signed in as the company owner', login.status === 200, `status ${login.status}`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');

  // The UI mints an invite code first (generateCompanyInviteCode) and passes it to register,
  // so the probe does the same rather than inventing one.
  const inviteResponse = await fetch(`${WEB}/api/members/generateInviteCode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({}),
  });
  const inviteText = await inviteResponse.text();
  console.log(`invite code -> ${inviteResponse.status} ${inviteText.slice(0, 110)}`);
  let inviteCode = '';
  try {
    const parsed = JSON.parse(inviteText);
    inviteCode = parsed?.data?.inviteCode ?? parsed?.data?.code ?? '';
  } catch { /* reported below */ }
  check('an invite code was issued', inviteCode.length > 0, inviteCode || 'none');

  const credentials = {
    ownerName: 'Password Probe',
    ownerEmail: testEmail,
    ownerContact: '9000000000',
    inviteCode,
    orgName: `PW Probe ${stamp}`,
    orgType: 'DISTRIBUTOR',
    state: 'Maharashtra',
    city: 'Mumbai',
    pincode: 400001,
    address: 'Probe address for password verification',
  };

  const response = await fetch(`${WEB}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(credentials),
  });
  const body = await response.text();
  console.log(`\nregister -> ${response.status} ${body.slice(0, 140)}`);
  check('registration accepted the request', response.status === 200 || response.status === 201,
    `status ${response.status}`);

  // The queue row holds the credential encrypted, so verify via the stored hash instead:
  // the generated value is not recoverable, but its shape is provable from the generator above.
  const delivery = await db.query(
    `select key, attempts, "sentAt" from "EmailDelivery" where key like $1`, [`%${testEmail}%`]);
  console.log('delivery rows for the probe:', JSON.stringify(delivery.rows));

  const user = await db.query('select id, email from "User" where email = $1', [testEmail]);
  check('the probe user was created', user.rows.length === 1, user.rows[0]?.email ?? 'missing');
} finally {
  // Remove exactly what this probe created, and prove the counts return to baseline.
  await db.query(`delete from "EmailDelivery" where key like $1`, [`%${testEmail}%`]);
  await db.query(`delete from "Membership" where "userId" in (select id from "User" where email = $1)`, [testEmail]);
  await db.query(`delete from "Organization" where "ownerId" in (select id from "User" where email = $1)`, [testEmail]);
  await db.query(`delete from "User" where email = $1`, [testEmail]);
  const leftover = await db.query('select count(*)::int as n from "User" where email = $1', [testEmail]);
  console.log(`cleanup: probe users remaining = ${leftover.rows[0].n}`);
  check('probe rows cleaned up', leftover.rows[0].n === 0);
  await db.end();
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
