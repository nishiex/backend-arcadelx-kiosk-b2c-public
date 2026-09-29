// Audit harness only. Runs unchanged application handlers against a NEW database.
// Run from repo root: npx tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
// Retains audit database and evidence; never resets/deletes/reseeds existing data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import Mailjet from 'node-mailjet';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/api');
const root = path.resolve(apiDir, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const configuredUrl = new URL(process.env.DATABASE_URL!);
const configuredDirectUrl = process.env.DIRECT_URL!;
// The live API currently targets Supabase. Never mutate that database for this audit.
const originalUrl = new URL('postgresql://postgres@localhost:5433/arcadelx');
originalUrl.password = execFileSync('docker', ['exec','arcadelx-pg','printenv','POSTGRES_PASSWORD'], {encoding:'utf8'}).trim();
if (!['localhost', '127.0.0.1'].includes(originalUrl.hostname) || originalUrl.port !== '5433') {
  throw new Error('Audit requires the documented local PostgreSQL on 5433.');
}
const runId = new Date().toISOString().replace(/[^0-9]/g, '');
const database = `arcadelx_audit_${runId}`;
const outDir = path.join(root, 'audits', 'distributor-lifecycle', runId);
fs.mkdirSync(outDir, { recursive: true });
const evidence: any[] = [];
function record(id: string, details: any) {
  evidence.push({ id, ...details });
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(id, details.pass === undefined ? '' : details.pass ? 'PASS' : 'MISMATCH');
}
const source = new pg.Client({ connectionString: originalUrl.href, application_name: 'distributor_audit_source_readonly' });
await source.connect();
await source.query('SET default_transaction_read_only = on');
async function fingerprint(client: any) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result: any = {};
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    result[tablename] = (await client.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS digest FROM (SELECT md5(row_to_json(t)::text) h FROM public.${quoted} t) s`)).rows[0];
  }
  return result;
}
const before = await fingerprint(source);
const schema = execFileSync('docker', ['exec', 'arcadelx-pg', 'pg_dump', '-U', 'postgres', '-d', originalUrl.pathname.slice(1), '--schema-only', '--no-owner', '--no-privileges'], { encoding: 'utf8' });
fs.writeFileSync(path.join(outDir, 'source-local-schema.sql'), schema);
const constraints = (await source.query("SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2")).rows;
const indexes = (await source.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2")).rows;
const migrations = (await source.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
record('environment', { database, configuredRuntime: { host: configuredUrl.hostname, port: configuredUrl.port, database: configuredUrl.pathname }, sourceDatabase: originalUrl.pathname.slice(1), before, constraints, indexes, migrations, emailTransport: 'in-memory capture; no external send', server: 'unmodified src/app.ts on ephemeral loopback port' });
const remote = new pg.Client({ connectionString: configuredDirectUrl, connectionTimeoutMillis: 10000, statement_timeout: 10000, application_name: 'distributor_audit_schema_readonly' });
let remoteSnapshot: any;
try {
  await remote.connect();
  await remote.query('BEGIN READ ONLY');
  const remoteConstraints = (await remote.query("SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2")).rows;
  const remoteIndexes = (await remote.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2")).rows;
  const remoteMigrations = (await remote.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  remoteSnapshot = { constraints: remoteConstraints, indexes: remoteIndexes, migrations: remoteMigrations, columns: (await remote.query("SELECT table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows };
  record('configured-database-schema-readonly', remoteSnapshot);
  await remote.query('COMMIT');
} catch (error: any) { record('configured-database-schema-unavailable', { message: error.message }); }
finally { await remote.end(); }
const admin = new pg.Client({ connectionString: originalUrl.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
const auditUrl = new URL(originalUrl.href);
auditUrl.pathname = '/' + database;
process.env.DATABASE_URL = auditUrl.href;
process.env.DIRECT_URL = auditUrl.href;
process.env.ACCESS_SECRET_TOKEN = crypto.randomBytes(64).toString('hex');
process.env.REFRESH_SECRET_TOKEN = crypto.randomBytes(64).toString('hex');
process.env.INTERNAL_API_SECRET = crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'development';
process.env.ACCESS_EXPIRY = '2h';
process.env.MAILJET_API_KEY = 'audit-local';
process.env.MAILJET_SECRET_KEY = 'audit-local';
process.env.MAIL_FROM_EMAIL = 'audit@example.invalid';
process.env.MAIL_FROM_NAME = 'Local audit';
process.env.FRONTEND_LOGIN_URL = 'http://localhost:3000/login';
const sql = new pg.Client({ connectionString: auditUrl.href, application_name: 'distributor_audit_observer' });
await sql.connect();
// The existing Docker DB is behind the repository (six migrations, no Order table).
// Apply all existing SQL migrations only to the newly created audit DB.
const migrationDir = path.join(apiDir, 'prisma/migrations');
const applied = [];
for (const name of fs.readdirSync(migrationDir).sort()) {
  const file = path.join(migrationDir, name, 'migration.sql');
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  await sql.query(text);
  applied.push({ name, sha256: crypto.createHash('sha256').update(text).digest('hex') });
}
record('isolated-schema-applied', { migrations: applied, constraints: (await sql.query("SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2")).rows, indexes: (await sql.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2")).rows });
const isolatedSchema = evidence.find(x=>x.id==='isolated-schema-applied');
if(remoteSnapshot) {
  record('schema-comparison', { missingOrDifferentConstraintsOnConfiguredDatabase: isolatedSchema.constraints.filter((x:any)=>!remoteSnapshot.constraints.some((y:any)=>x.table_name===y.table_name && x.conname===y.conname && x.definition===y.definition)), missingOrDifferentIndexesOnConfiguredDatabase:isolatedSchema.indexes.filter((x:any)=>!remoteSnapshot.indexes.some((y:any)=>x.indexname===y.indexname && x.indexdef===y.indexdef)), extraConfiguredMigrations:remoteSnapshot.migrations.filter((x:any)=>!applied.some(y=>y.name===x.migration_name)).map((x:any)=>x.migration_name) });
}
function sourceHashes() {
  const hashes:any={};
  function visit(dir:string) {for(const file of fs.readdirSync(dir,{withFileTypes:true})) {if(file.name==='generated')continue;const full=path.join(dir,file.name);if(file.isDirectory())visit(full);else hashes[path.relative(root,full)]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}}
  for(const dir of [path.join(apiDir,'src'),path.join(apiDir,'prisma'),path.join(root,'packages/shared-types')])visit(dir);
  return hashes;
}
const hashesBefore=sourceHashes();
record('source-hashes-before',{hashes:hashesBefore});
process.chdir(outDir); // Keeps generated invoices separate from app invoices.
const mails: any[] = [];
let failMail = false;
(Mailjet as any).apiConnect = () => ({ post: () => ({ request: async (body: any) => {
  if (failMail) throw new Error('AUDIT injected mail transport failure');
  mails.push(body.Messages[0]);
  return { body: { Messages: [{ Status: 'success' }] } };
} }) });
const { default: app } = await import(pathToFileURL(path.join(apiDir,'src/app.ts')).href);
const { prisma } = await import(pathToFileURL(path.join(apiDir,'src/utils/db.ts')).href);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const password = crypto.randomBytes(20).toString('base64url');
const actors: Record<string, any> = {};
let seq = 0;
function sanitize(value: any): any {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /password|token|cookie|secret/i.test(k) ? '[redacted]' : sanitize(v)]));
  return value;
}
async function http(id: string, actor: any, method: string, route: string, body?: any, expected?: number | number[]) {
  const response = await fetch(base + route, { method, headers: { ...(actor?.cookie ? { Cookie: actor.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const contentType = response.headers.get('content-type') || '';
  const pdf = contentType.includes('pdf') ? Buffer.from(await response.arrayBuffer()) : undefined;
  const data = contentType.includes('json') ? await response.json() : pdf ? { bytes: pdf.byteLength, contentType } : (await response.text()).slice(0,500);
  const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  record(id, { kind: 'HTTP', actor: actor?.label || 'unauthenticated', method, route, request: sanitize(body), status: response.status, expected, ...(expected === undefined ? {} : { pass: (Array.isArray(expected) ? expected : [expected]).includes(response.status) }), response: sanitize(data) });
  return { status: response.status, data, cookies, pdf, cacheControl: response.headers.get('cache-control') };
}
function check(id: string, pass: boolean, details: any = {}) { record(id, { kind: 'assertion', pass, ...details }); }
async function login(label: string, email: string, pass = password) {
  const r = await http(`login-${label}`, null, 'POST', '/api/auth/login', { email, password: pass }, 200);
  if (!r.cookies) throw new Error(`Login failed for ${label}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { membership: { include: { organization: true } } } });
  return actors[label] = { label, email, cookie: r.cookies, userId: user.id, orgId: user.membership?.organizationId, type: user.membership?.organization.type, role: user.membership?.role };
}
async function fixture(label: string, type: any, orgId?: string, role: any = 'OWNER', status: any = 'ACTIVE') {
  const email = `${label.toLowerCase()}@example.invalid`;
  const user = await prisma.user.create({ data: { name: label, email, passwordHash: await bcrypt.hash(password, 4) } });
  if (!orgId) {
    const org = await prisma.organization.create({ data: { name: label, type, ownerId: user.id, city: 'Mumbai', state: 'Maharashtra', pincode: 400001, address: 'Audit fixture address' } });
    orgId = org.id;
  }
  await prisma.membership.create({ data: { userId: user.id, organizationId: orgId, role, status } });
  record(`fixture-${label}`, { kind: 'direct DB fixture', organizationId: orgId, userId: user.id, type, role, status });
  return login(label, email);
}
function registration(label: string, type = 'DISTRIBUTOR') { return { orgName: label, ownerName: label, ownerEmail: `${label}@example.invalid`, orgType: type, city: 'Mumbai', state: 'Maharashtra', pincode: 400001, address: 'Audit organization address' }; }
async function register(label: string, parent: any, type = 'DISTRIBUTOR', extra = {}) {
  const body = { ...registration(label, type), ...extra };
  const r = await http(`register-${label}`, parent, 'POST', '/api/auth/register', body, 201);
  if (r.status !== 201) throw new Error(`Registration prerequisite failed: ${label}`);
  const message = mails.findLast(m => m.To[0].Email === body.ownerEmail);
  const temp = message?.TextPart.match(/Temporary Password:\s*([^\s]+)/)?.[1];
  if (!temp) throw new Error('No credentials captured');
  const actor = await login(label, body.ownerEmail, temp);
  check(`registration-records-${label}`, actor.type === type && actor.role === 'OWNER', { actor: sanitize({ ...actor, cookie: undefined }) });
  return actor;
}
async function connect(label: string, parent: any, child: any) {
  const r = await http(`${label}-initiate`, parent, 'POST', '/api/network/initiate', { targetOwnerEmail: child.email }, 201);
  const connection = r.data.data.connection;
  check(`${label}-pending`, connection.status === 'PENDING', { connection });
  await http(`${label}-accept`, child, 'POST', `/api/network/${connection.id}/accept`, undefined, 200);
  return connection;
}
function terms(connectionId: string, childId: string, extra = {}) { return { networkConnectionId: connectionId, childOrgId: childId, parentSharePct: 60, childSharePct: 40, depositAmountPerMachine: 1000, nonRefundableAmountPerMachine: 200, ...extra }; }
async function agreement(label: string, parent: any, child: any, connection: any, extra = {}) {
  const r = await http(`${label}-create`, parent, 'POST', '/api/agreements/create', terms(connection.id, child.orgId, extra), 201);
  const row = r.data.data.agreement;
  await http(`${label}-approve`, child, 'PATCH', `/api/agreements/${row.id}/approve`, undefined, 200);
  return row;
}
async function order(label: string, actor: any, type: string, target: any, quantity = 1) {
  const r = await http(`${label}-create`, actor, 'POST', '/api/orders/create', { type, targetOrgId: target.orgId, quantity }, 201);
  if (!r.data?.data?.order) throw new Error(`Order prerequisite failed: ${label}`);
  return r.data.data.order;
}
async function finishOrder(label: string, parent: any, row: any) {
  if (row.status === 'UNDER_REVIEW') await http(`${label}-approve`, parent, 'PATCH', `/api/orders/${row.id}/approve`, undefined, 200);
  for (const action of ['paid','dispatch','deliver']) await http(`${label}-${action}`, parent, 'PATCH', `/api/orders/${row.id}/${action}`, undefined, 200);
}
async function snapshot(id: string, rowId: string) {
  const row = await prisma.order.findUniqueOrThrow({ where: { id: rowId }, include: { dispatchedKiosks: { include: { kiosk: { include: { assignments: { orderBy: { assignedFrom: 'asc' } } } } } } } });
  record(id, { kind: 'database snapshot', row });
  return row;
}

const ctx: any = { prisma, sql, auditUrl, record, check, http, login, fixture, registration, register, connect, terms, agreement, order, finishOrder, snapshot, actors, mails, setFailMail: (v: boolean) => { failMail = v; }, password, outDir, next: () => ++seq };
try {
  for (const phase of (process.env.AUDIT_PHASES || 'happy,fixes').split(',')) {
    console.log(`BEGIN PHASE ${phase}`);
    const module = await import(`./phases/${phase}.ts`);
    await module.run(ctx);
    console.log(`END PHASE ${phase}`);
  }
} catch (error: any) {
  record('harness-error', { message: error.message, stack: error.stack });
  process.exitCode = 1;
} finally {
  failMail = false;
  const after = await fingerprint(source);
  const hashesAfter=sourceHashes();
  check('application-sources-unchanged',JSON.stringify(hashesBefore)===JSON.stringify(hashesAfter),{hashesAfter});
  check('existing-database-unchanged', JSON.stringify(before) === JSON.stringify(after), { before, after });
  record('run-summary', { database, requests: evidence.filter(e => e.kind === 'HTTP').length, checks: evidence.filter(e => e.kind === 'assertion').length, mismatches: evidence.filter(e => e.pass === false).map(e => e.id), mailsCaptured: mails.length, noExternalEmailSent: true, output: outDir });
  if (evidence.some(e => e.pass === false)) process.exitCode = 1;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await prisma.$disconnect();
  await sql.end();
  await source.end();
}
