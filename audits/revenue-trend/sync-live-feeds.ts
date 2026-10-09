// Register the live device fleet and import its payments into a specific database, using the
// existing production services (syncDevices -> syncRevenueData, the same order the nightly
// worker uses: devices must exist before a payment can be attributed to a kiosk).
//
// The schedulers need Redis and do not run on Vercel, so this is the on-demand equivalent.
//
//   $env:TARGET_DATABASE_URL = '<deployment url>'
//   node -r ./audits/auth-registration/runtime-loader.cjs audits/revenue-trend/sync-live-feeds.ts
//
// No credential is stored here; the URL is supplied by the operator at run time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const target = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || '';
if (!target) throw new Error('set TARGET_DATABASE_URL');

const host = new URL(target).hostname;
// Guard: either the local Docker database, or an explicitly named Supabase deployment host.
if (!['localhost', '127.0.0.1'].includes(host) && !host.endsWith('.supabase.com')) {
  throw new Error(`refusing to sync into unrecognised host ${host}`);
}

// Point the services (which read process.env at call time) at the chosen database.
process.env.DATABASE_URL = target;
process.env.DIRECT_URL = target;
if (!process.env.MOTHERSHIP_TRANSACTION_API_URL) throw new Error('MOTHERSHIP_TRANSACTION_API_URL is not configured');
if (!process.env.MOTHERSHIP_DEVICE_API_URL) throw new Error('MOTHERSHIP_DEVICE_API_URL is not configured');

const { syncDevices } = await import('../../apps/api/src/services/Revenue/deviceSync.service');
const { syncRevenueData } = await import('../../apps/api/src/services/Revenue/revenueTransaction.services');
const { prisma } = await import('../../apps/api/src/utils/db');

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  database: host,
  deviceSource: process.env.MOTHERSHIP_DEVICE_API_URL,
  paymentSource: process.env.MOTHERSHIP_TRANSACTION_API_URL,
};

try {
  console.log(`syncing into ${host}`);
  console.log(`  devices  <- ${process.env.MOTHERSHIP_DEVICE_API_URL}`);
  evidence.devices = await syncDevices();
  console.log('  devices result: ' + JSON.stringify(evidence.devices));

  console.log(`  payments <- ${process.env.MOTHERSHIP_TRANSACTION_API_URL}`);
  evidence.transactions = await syncRevenueData();
  console.log('  payments result: ' + JSON.stringify(evidence.transactions));

  // Read back what actually landed, so the result is not just the sync's own report.
  evidence.after = {
    kiosks: await prisma.kiosk.count(),
    withExternalDeviceId: await prisma.kiosk.count({ where: { externalDeviceId: { not: null } } }),
    transactions: await prisma.transaction.count(),
    totalAmount: Number((await prisma.transaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0),
    assignments: await prisma.kioskAssignment.count(),
  };
  console.log('database after sync: ' + JSON.stringify(evidence.after));

  const out = path.join(root, 'audits/revenue-trend/sync-live-feeds.json');
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log('evidence: ' + path.relative(root, out).replace(/\\/g, '/'));
} finally {
  await prisma.$disconnect();
}
