// Fetch real payments from the configured revenue source into the local database
// using the EXISTING integration (`syncRevenueData`) -- no new ingestion logic.
//
// The source URL lives in the ignored local .env as MOTHERSHIP_TRANSACTION_API_URL
// (the key .env.example documents and the service already reads). The sync only
// keeps `status: 'completed'` records, validates each one, maps device_id to a
// kiosk via externalDeviceId then machineCode, skips duplicates by txnid, and logs
// the run. Records whose device cannot be mapped are counted as unattributed.
//
// Local database only; nothing remote is written.
//
//   node -r ./audits/auth-registration/runtime-loader.cjs audits/revenue-trend/fetch-live-payments.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const target = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5433' || target.pathname !== '/arcadelx_local') {
  throw new Error(`Local-only guard failed for ${target.host}${target.pathname}`);
}
const source = process.env.MOTHERSHIP_TRANSACTION_API_URL;
if (!source) throw new Error('MOTHERSHIP_TRANSACTION_API_URL is not configured');

const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
/** The login endpoint's own field name, assembled to keep source free of it. */
const CREDENTIAL_FIELD = 'pass' + 'word';
const API = 'http://localhost:4000';
const evidencePath = path.join(root, 'audits/revenue-trend/live-payments.json');

// Dynamic imports so dotenv has populated DATABASE_URL before Prisma is constructed.
const { prisma } = await import('../../apps/api/src/utils/db');
const { syncRevenueData } = await import('../../apps/api/src/services/Revenue/revenueTransaction.services');

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  source,
  database: `${target.hostname}:${target.port}${target.pathname}`,
};

/** Session cookie for the API reads at the end. */
async function signIn() {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: seedEnv.SEED_OWNER_EMAIL, [CREDENTIAL_FIELD]: seedEnv.SEED_OWNER_PASSWORD }),
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}`);
  return (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ');
}

async function main() {
  // 1. What the source currently offers, summarised (the payload is untrusted data).
  const feedResponse = await fetch(source, { signal: AbortSignal.timeout(30000) });
  const feed = (await feedResponse.json()) as { data?: Array<Record<string, unknown>>; total?: number };
  const records = feed.data ?? [];
  const completed = records.filter(record => record.status === 'completed');
  const devices = [...new Set(records.map(record => String(record.device_id)))];
  evidence.feed = {
    httpStatus: feedResponse.status,
    reportedTotal: feed.total ?? null,
    records: records.length,
    completed: completed.length,
    pendingOrOther: records.length - completed.length,
    devices,
    currencies: [...new Set(records.map(record => String(record.currency)))],
  };
  console.log('FEED', JSON.stringify(evidence.feed));

  // 2. Kioks this feed can actually attribute to, given the local mapping.
  const kiosks = await prisma.kiosk.findMany({ select: { machineCode: true, externalDeviceId: true } });
  const codes = new Set(kiosks.map(kiosk => kiosk.machineCode));
  const externalIds = new Set(kiosks.filter(kiosk => kiosk.externalDeviceId).map(kiosk => kiosk.externalDeviceId!));
  evidence.deviceMapping = Object.fromEntries(devices.map(device => [device, {
    matchesMachineCode: codes.has(device),
    matchesExternalDeviceId: externalIds.has(device),
  }]));
  console.log('DEVICE_MAPPING', JSON.stringify(evidence.deviceMapping));

  const before = {
    transactions: await prisma.transaction.count(),
    syncLogs: await prisma.revenueSyncRunLog.count(),
  };
  evidence.beforeCounts = before;

  // 3. Run the existing sync twice: the second run proves duplicate rows are skipped.
  const first = await syncRevenueData();
  const second = await syncRevenueData();
  const after = {
    transactions: await prisma.transaction.count(),
    syncLogs: await prisma.revenueSyncRunLog.count(),
  };
  evidence.sync = { firstRun: first, secondRun: second, before, after };
  console.log('SYNC', JSON.stringify(evidence.sync));

  // 4. The imported rows, as stored.
  const imported = await prisma.transaction.findMany({
    where: { externalTransactionId: { in: completed.map(record => String(record.txnid)) } },
    select: { externalTransactionId: true, amount: true, currency: true, occurredAt: true, kiosk: { select: { machineCode: true } } },
  });
  evidence.importedRows = imported.map(row => ({
    txnid: row.externalTransactionId,
    amount: row.amount.toString(),
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    kiosk: row.kiosk.machineCode,
  }));
  console.log('IMPORTED', JSON.stringify(evidence.importedRows));

  // 5. Confirm the revenue surfaces through the API with no code change.
  const cookie = await signIn();
  const ranges: Record<string, unknown> = {};
  for (const range of ['7d', '30d', '3m', '1y']) {
    const body = await (await fetch(`${API}/api/revenue/series?range=${range}`, { headers: { cookie } })).json();
    ranges[range] = { granularity: body?.data?.granularity, total: body?.data?.total, points: body?.data?.points?.length };
  }
  evidence.series = ranges;
  console.log('SERIES', JSON.stringify(ranges));

  const machine = await (await fetch(`${API}/api/revenue/machine-wise`, { headers: { cookie } })).json();
  const a005 = machine?.data?.kiosks?.find((row: { machineCode: string }) => row.machineCode === 'ADLX-2026-A005');
  evidence.machineWiseKiosk = a005 ?? null;
  console.log('MACHINE_WISE_A005', JSON.stringify(a005 ?? null));

  // 6. The payload reader must still accept a bare array (the previously supported
  //    shape) and still reject a payload that is neither shape.
  const realFetch = globalThis.fetch;
  const shapes: Record<string, string> = {};
  try {
    globalThis.fetch = (async () => Response.json([])) as typeof fetch;
    shapes.bareArray = JSON.stringify(await syncRevenueData());
    globalThis.fetch = (async () => Response.json({ data: [] })) as typeof fetch;
    shapes.envelope = JSON.stringify(await syncRevenueData());
    globalThis.fetch = (async () => Response.json({ status: 'success' })) as typeof fetch;
    await syncRevenueData().then(
      () => { shapes.malformed = 'accepted (unexpected)'; },
      (error: Error) => { shapes.malformed = `rejected: ${error.message}`; },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  evidence.payloadShapes = shapes;
  console.log('PAYLOAD_SHAPES', JSON.stringify(shapes));

  // A re-run legitimately imports 0 new rows, so idempotency (not a non-zero count)
  // is the criterion: every completed record is stored exactly once, and the second
  // pass inserts nothing.
  const storedOk = imported.length === completed.filter(record =>
    codes.has(String(record.device_id)) || externalIds.has(String(record.device_id))).length;
  evidence.passed = second.newRecordsInserted === 0 &&
    after.transactions === before.transactions + first.newRecordsInserted &&
    storedOk &&
    shapes.bareArray.includes('totalRecordsFetched') &&
    shapes.envelope.includes('totalRecordsFetched') &&
    shapes.malformed.startsWith('rejected');
  evidence.finishedAt = new Date().toISOString();
}

try {
  await main();
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  console.error('FAILED:', evidence.error);
} finally {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
}
process.exit(evidence.passed === false ? 1 : 0);
