// Live proof for the per-device price override contract, using the EXISTING service.
//
//   node -r ./audits/auth-registration/runtime-loader.cjs audits/devices/verify-device-price-override.ts
//
// Why this exists: the device-scoped write previously sent `{ override_price, ... }`, which
// Mothership accepted with 200 "success" and ignored, so every per-device price change
// looked like an unsupported upstream feature. The confirmed contract is `{ price,
// replay_price }` (2026-10-13). This script drives the real service against the live host
// for one offline device and one game, proves the override persisted and that no other
// device or catalog price moved, then resets the device again -- it leaves no state behind.
//
// It WRITES live pricing, so it refuses to run without an explicit opt-in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

if (process.env.ALLOW_LIVE_MOTHERSHIP_WRITE !== '1') {
  throw new Error('Refusing to run: set ALLOW_LIVE_MOTHERSHIP_WRITE=1 to write live Mothership pricing');
}

const { listDevices, getDevicePrices, setDeviceGamePrice, resetDevicePrices } = await import(
  '../../apps/api/src/services/Mothership/devices.service'
);

// An offline device (last seen 2026-10-09) so a price write cannot reach a paying customer.
const DEVICE_ID = '0dcb12aa-2298-11ea-af01-d5b8d5c63200';
const GAME_ID = 'Bennys Sweet Jump';
const PRICE = 137;
const REPLAY_PRICE = 41;

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  deviceId: DEVICE_ID,
  gameId: GAME_ID,
  requested: { price: PRICE, replayPrice: REPLAY_PRICE },
};

function rowFor(prices: Awaited<ReturnType<typeof getDevicePrices>>, gameId: string) {
  const row = prices.find((game) => game.gameId === gameId);
  if (!row) throw new Error(`game ${gameId} is missing from the device readback`);
  return row;
}

function describe(row: ReturnType<typeof rowFor>) {
  return {
    price: row.effectivePrice,
    replayPrice: row.effectiveReplayPrice,
    basePrice: row.basePrice,
    baseReplayPrice: row.baseReplayPrice,
    hasOverride: row.hasOverride,
    overridePrice: row.overridePrice,
    overrideReplayPrice: row.overrideReplayPrice,
  };
}

/** Effective price of every game on every device, so a fleet-wide side effect cannot hide. */
async function fleetSnapshot(deviceIds: string[]) {
  const entries = await Promise.all(
    deviceIds.map(async (id) => [id, await getDevicePrices(id)] as const),
  );
  return new Map(entries);
}

function diffFleet(
  before: Awaited<ReturnType<typeof fleetSnapshot>>,
  after: Awaited<ReturnType<typeof fleetSnapshot>>,
  excludeDeviceId: string,
) {
  const changed: string[] = [];
  for (const [id, afterPrices] of after) {
    if (id === excludeDeviceId) continue;
    const beforePrices = before.get(id);
    const same =
      beforePrices?.length === afterPrices.length &&
      beforePrices.every((row, index) => {
        const next = afterPrices[index];
        return (
          row.gameId === next.gameId &&
          row.effectivePrice === next.effectivePrice &&
          row.effectiveReplayPrice === next.effectiveReplayPrice
        );
      });
    if (!same) changed.push(id);
  }
  return changed;
}

const { devices } = await listDevices();
const deviceIds = [...new Set(devices.map((device) => device.deviceId))];
if (!deviceIds.includes(DEVICE_ID)) throw new Error(`device ${DEVICE_ID} is not in the fleet`);

const before = await fleetSnapshot(deviceIds);
const beforeRow = describe(rowFor(before.get(DEVICE_ID)!, GAME_ID));
evidence.before = beforeRow;
console.log(`before      : ${GAME_ID} on ${DEVICE_ID} -> ${JSON.stringify(beforeRow)}`);

// The service re-reads everything and throws unless the override persisted on this device
// alone, so a resolved promise is itself the contract proof.
const result = await setDeviceGamePrice(DEVICE_ID, GAME_ID, {
  price: PRICE,
  replay_price: REPLAY_PRICE,
  scope: 'DEVICE',
});
evidence.result = result;
console.log(`write result: ${JSON.stringify(result)}`);

const after = await fleetSnapshot(deviceIds);
const afterRow = describe(rowFor(after.get(DEVICE_ID)!, GAME_ID));
const changedDevices = diffFleet(before, after, DEVICE_ID);
evidence.after = afterRow;
evidence.changedOtherDevices = changedDevices;

const verified =
  afterRow.hasOverride === true &&
  afterRow.overridePrice === PRICE &&
  afterRow.overrideReplayPrice === REPLAY_PRICE &&
  afterRow.price === PRICE &&
  afterRow.price !== beforeRow.price &&
  afterRow.basePrice === beforeRow.basePrice &&
  afterRow.baseReplayPrice === beforeRow.baseReplayPrice &&
  changedDevices.length === 0;
evidence.verified = verified;
console.log(`after       : ${JSON.stringify(afterRow)}`);
console.log(`other devices changed: ${changedDevices.length === 0 ? 'none' : changedDevices.join(', ')}`);

// Always put the device back: the test must not leave a price behind.
const reset = await resetDevicePrices(DEVICE_ID);
evidence.reset = reset;
const final = await fleetSnapshot(deviceIds);
const finalRow = describe(rowFor(final.get(DEVICE_ID)!, GAME_ID));
const changedAfterReset = diffFleet(before, final, DEVICE_ID);
evidence.afterReset = finalRow;
evidence.changedOtherDevicesAfterReset = changedAfterReset;
const reverted = finalRow.hasOverride === false && finalRow.price === beforeRow.price && changedAfterReset.length === 0;
evidence.reverted = reverted;
console.log(`after reset : ${JSON.stringify(finalRow)}`);
console.log(`reverted cleanly: ${reverted}`);

evidence.finishedAt = new Date().toISOString();
const evidencePath = path.join(root, 'audits/devices/live-device-price-override.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence    : ${path.relative(root, evidencePath)}`);

if (!verified) throw new Error('the device price override was not verified');
if (!reverted) throw new Error('the device was not restored to its catalog price');
console.log('PASS live: device override persists for one device only, then resets cleanly');
