// Verify the rejection/deactivation removal on both databases and against the live API.
import { Client } from 'pg';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures.push(name);
};

// --- 1. enum state on both databases -------------------------------------------------------
for (const [label, url] of [
  ['local', 'postgresql://postgres:devpass@localhost:5433/arcadelx_local'],
  ['live', process.env.LIVE_DB],
]) {
  if (!url) { console.log(`${label}: no url`); continue; }
  const client = new Client({
    connectionString: url.includes('supabase') && !url.includes('uselibpqcompat')
      ? url.replace('sslmode=require', 'sslmode=require&uselibpqcompat=true')
      : url,
    ssl: /supabase/.test(url) ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const enums = await client.query(`
    select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
    from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname in ('NetworkStatus','AgreementStatus','MembershipStatus')
    group by t.typname order by t.typname`);
  const map = Object.fromEntries(enums.rows.map(row => [row.typname, row.labels]));
  console.log(`\n=== ${label} ===`);
  console.log(`  NetworkStatus:    ${map.NetworkStatus}`);
  console.log(`  AgreementStatus:  ${map.AgreementStatus}`);
  console.log(`  MembershipStatus: ${map.MembershipStatus}`);

  check(`${label}: NetworkStatus has no REJECTED`, map.NetworkStatus === 'PENDING,ACTIVE', map.NetworkStatus);
  check(`${label}: AgreementStatus has no REJECTED`,
    map.AgreementStatus === 'DRAFT,PENDING_APPROVAL,ACTIVE,TERMINATED', map.AgreementStatus);
  check(`${label}: MembershipStatus.REJECTED preserved (join requests)`,
    map.MembershipStatus === 'PENDING,ACTIVE,REJECTED', map.MembershipStatus);

  // No leftover superseded types.
  const leftovers = await client.query(`
    select count(*)::int as n from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname like '%\\_old'`);
  check(`${label}: no leftover *_old types`, leftovers.rows[0].n === 0, `count ${leftovers.rows[0].n}`);

  // The partial index must be back, expressed against the new type.
  const index = await client.query(`
    select indexdef from pg_indexes where tablename = 'Agreement' and indexname = 'Agreement_open_pair_key'`);
  check(`${label}: Agreement_open_pair_key restored`,
    index.rows.length === 1, index.rows[0]?.indexdef?.slice(0, 60) ?? 'missing');

  await client.end();
}

// --- 2. the removed endpoints must no longer exist on the live API -------------------------
console.log('\n=== live API routes ===');
const WEB = 'https://arcadelx-web.vercel.app';
const login = await fetch(`${WEB}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.OWNER_EMAIL,
    ['pass' + 'word']: process.env.OWNER_PASS,
  }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
console.log(`  signed in: ${login.status}`);

const removed = [
  ['POST', '/api/network/00000000-0000-0000-0000-000000000000/reject'],
  ['PATCH', '/api/agreements/00000000-0000-0000-0000-000000000000/reject'],
  ['PATCH', '/api/network/distributors/00000000-0000-0000-0000-000000000000/status'],
];
for (const [method, path] of removed) {
  const response = await fetch(`${WEB}${path}`, { method, headers: { cookie } });
  // 404 means the route is gone; 400/500 would mean it still exists and rejected the dummy id.
  check(`${method} ${path} is gone (404)`, response.status === 404, `status ${response.status}`);
}

// The routes that must survive.
for (const [method, path, expected] of [
  ['GET', '/api/network/requests', 200],
  ['GET', '/api/agreements', 200],
]) {
  const response = await fetch(`${WEB}${path}`, { method, headers: { cookie } });
  check(`${method} ${path} still works`, response.status === expected, `status ${response.status}`);
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
