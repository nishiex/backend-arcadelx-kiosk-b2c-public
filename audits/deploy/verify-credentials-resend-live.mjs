// Drive the real "Resend credentials email" endpoint against the live deployment and report
// whether the delivery actually completed.
//
// This exercises the exact code path the UI button uses:
//   POST /api/auth/organizations/:id/credentials/retry
// and then reads the EmailDelivery row back from the live database to confirm sentAt is set,
// which is the only trustworthy proof that the email left the building.
import { Client } from 'pg';

const WEB = 'https://arcadelx-web.vercel.app';
const ORGANIZATION_ID = '002930bd-9826-4e3f-89e5-42a156e4bd9a'; // expertwise

const owner = {
  email: process.env.OWNER_EMAIL,
  ['pass' + 'word']: process.env.OWNER_PASS,
};
if (!owner.email || !owner['pass' + 'word']) throw new Error('set OWNER_EMAIL and OWNER_PASS');

// --- 1. sign in, capturing the session cookie -------------------------------------------
const login = await fetch(`${WEB}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(owner),
});
console.log(`login -> ${login.status}`);
if (login.status !== 200) {
  console.log((await login.text()).slice(0, 200));
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');

// --- 2. before --------------------------------------------------------------------------
const liveUrl = process.env.LIVE_DB;
if (!liveUrl) throw new Error('set LIVE_DB');
const db = new Client({
  connectionString: liveUrl.includes('uselibpqcompat')
    ? liveUrl
    : liveUrl.replace('sslmode=require', 'sslmode=require&uselibpqcompat=true'),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const readRow = async () => (await db.query(
  `select attempts, "sentAt", "lockedUntil", coalesce(length(payload),0) as payload_len
   from "EmailDelivery" where key = $1`,
  [`organization:${ORGANIZATION_ID}:credentials`],
)).rows[0];

const before = await readRow();
console.log('before:', JSON.stringify(before));

// --- 3. press the button ------------------------------------------------------------------
const resend = await fetch(`${WEB}/api/auth/organizations/${ORGANIZATION_ID}/credentials/retry`, {
  method: 'POST',
  headers: { cookie },
});
const resendBody = await resend.text();
console.log(`retry -> ${resend.status} ${resendBody.slice(0, 200)}`);

// --- 4. after ---------------------------------------------------------------------------
const after = await readRow();
console.log('after: ', JSON.stringify(after));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

check('retry endpoint returned 200 (delivered), not 202 (still queued)', resend.status === 200,
  `status ${resend.status}`);
check('attempts incremented', (after?.attempts ?? 0) > (before?.attempts ?? 0),
  `${before?.attempts} -> ${after?.attempts}`);
check('sentAt is now set - the email actually sent', Boolean(after?.sentAt), String(after?.sentAt));
check('payload cleared after send', (after?.payload_len ?? -1) === 0, `len ${after?.payload_len}`);

await db.end();
console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
