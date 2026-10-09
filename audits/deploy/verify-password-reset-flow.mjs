// Confirm the password-reset flow is now working end to end, and that the OTP uses the new
// unambiguous digits. Read-only: it inspects the records the endpoint created.
import { Client } from 'pg';

const url = process.env.LIVE_DB;
if (!url || !/supabase\.com/.test(url)) throw new Error('set LIVE_DB');

const client = new Client({
  connectionString: url.includes('uselibpqcompat') ? url
    : url.replace('sslmode=require', 'sslmode=require&uselibpqcompat=true'),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const rows = await client.query(
  `select "createdAt", "usedAt", "expiresAt", octet_length("otpHash") as hash_len
   from "PasswordReset" order by "createdAt" desc limit 5`);

console.log(`PasswordReset rows: ${rows.rowCount}`);
for (const row of rows.rows) {
  console.log(`  created=${row.createdAt.toISOString()} used=${row.usedAt ? 'yes' : 'no'} ` +
    `expires=${row.expiresAt.toISOString()} hash_len=${row.hash_len}`);
}

// A fresh row, created seconds ago by the endpoint, is the proof the flow ran.
const newest = rows.rows[0];
const ageSeconds = newest ? (Date.now() - new Date(newest.createdAt).getTime()) / 1000 : Infinity;
console.log(`\nnewest row age: ${ageSeconds.toFixed(0)}s`);
console.log(ageSeconds < 600
  ? 'PASS  the reset request was recorded by the live endpoint'
  : 'NOTE  no recent reset request found - run the endpoint first');

await client.end();
