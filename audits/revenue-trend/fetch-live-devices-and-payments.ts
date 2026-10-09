// Register the live device fleet and import its payments, using the EXISTING services.
//
// Runs the same code the nightly worker job runs (`syncDevices` then `syncRevenueData`),
// on demand, because the schedulers need Redis and are disabled locally.
//
//   node -r ./audits/auth-registration/runtime-loader.cjs audits/revenue-trend/fetch-live-devices-and-payments.ts
//
// Local database only. The device feed is the source of truth for `externalDeviceId`,
// which is what lets the payments sync attribute a transaction to a kiosk.
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
if (!process.env.MOTHERSHIP_DEVICE_API_URL) throw new Error('MOTHERSHIP_DEVICE_API_URL is not configured');
if (!process.env.MOTHERSHIP_TRANSACTION_API_URL) throw new Error('MOTHERSHIP_TRANSACTION_API_URL is not configured');

const evidencePath = path.join(root, 'audits/revenue-trend/live-devices-and-payments.json');
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  database: `${target.hostname}:${target.port}${target.pathname}`,
  deviceSource: process.env.MOTHERSHIP_DEVICE_API_URL,
  paymentSource: process.env.MOTHERSHIP_TRANSACTION_API_URL,
};

// Dynamic imports so dotenv has populated DATABASE_URL before Prisma is constructed.
const { prisma } = await import('../../apps/api/src/utils/db');
const { syncDevices } = await import('../../apps/api/src/services/Revenue/deviceSync.service');
const { syncRevenueData } = await import('../../apps/api/src/services/Revenue/revenueTransaction.services');

async function snapshot() {
  return {
    kiosks: await prisma.kiosk.count(),
    paired: await prisma.kiosk.count({ where: { externalDeviceId: { not: null } } }),
    transactions: await prisma.transaction.count(),
  };
}

try {
  evidence.before = await snapshot();
  console.log('BEFORE', JSON.stringify(evidence.before));

  // 1. Devices first: a payment can only be attributed to a kiosk that is recorded.
  const devices = await syncDevices();
  evidence.devices = devices;
  console.log('DEVICES', JSON.stringify(devices));

  // 2. Second run must be a no-op, proving the sync is idempotent.
  const devicesAgain = await syncDevices();
  evidence.devicesSecondRun = devicesAgain;
  console.log('DEVICES_RERUN', JSON.stringify(devicesAgain));

  // 3. Payments, twice, for the same reason.
  const payments = await syncRevenueData();
  const paymentsAgain = await syncRevenueData();
  evidence.payments = payments;
  evidence.paymentsSecondRun = paymentsAgain;
  console.log('PAYMENTS', JSON.stringify(payments));
  console.log('PAYMENTS_RERUN', JSON.stringify(paymentsAgain));

  evidence.after = await snapshot();
  console.log('AFTER', JSON.stringify(evidence.after));

  // What the fleet looks like now, including pairing and attribution.
  const kiosks = await prisma.kiosk.findMany({
    orderBy: { machineCode: 'asc' },
    select: {
      machineCode: true, model: true, status: true, externalDeviceId: true, location: true,
      _count: { select: { transactions: true } },
    },
  });
  evidence.fleet = kiosks.map(k => ({
    machineCode: k.machineCode, model: k.model, status: k.status,
    externalDeviceId: k.externalDeviceId, location: k.location, transactions: k._count.transactions,
  }));
  console.log('FLEET', JSON.stringify(evidence.fleet));

  evidence.passed =
    devicesAgain.newKiosksCreated === 0 &&
    paymentsAgain.newRecordsInserted === 0 &&
    evidence.after.kiosks >= evidence.before.kiosks;
  evidence.finishedAt = new Date().toISOString();
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  console.error('FAILED:', evidence.error);
} finally {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
}
process.exit(evidence.passed === false ? 1 : 0);
