// Regression check for Mothership responses where base_price/base_replay_price are the
// selected device's writable prices and override/effective metadata is omitted.
import assert from 'node:assert/strict';

process.env.MOTHERSHIP_DEVICE_API_URL = 'https://mothership.test';

const gameId = 'Beat Tap Revenge';
const devicePrices = new Map([
  ['D1', { price: 100, replayPrice: 40 }],
  ['D2', { price: 90, replayPrice: 40 }],
]);
let deviceWriteCount = 0;

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';

  if (url.pathname === '/api/v1/kiosks/device-ids') {
    return Response.json({
      device_ids: ['D1', 'D2'],
      kiosks: [
        { device_id: 'D1', is_online: true },
        { device_id: 'D2', is_online: true },
      ],
      total_kiosks: 2,
    });
  }
  if (url.pathname === '/api/v1/games') {
    return Response.json({
      games: [{ game_id: gameId, display_name: gameId, price: 120, replay_price: 50 }],
    });
  }
  if (url.pathname.endsWith('/prices') && method === 'GET') {
    const deviceId = url.pathname.split('/')[4];
    const current = devicePrices.get(deviceId);
    assert.ok(current, `unexpected device ${deviceId}`);
    return Response.json({
      device_id: deviceId,
      pricing: [{
        game_id: gameId,
        display_name: gameId,
        base_price: current.price,
        base_replay_price: current.replayPrice,
      }],
      status: 'success',
    });
  }
  if (
    url.pathname === `/api/v1/devices/D1/games/${encodeURIComponent(gameId)}/price` &&
    method === 'POST'
  ) {
    const body = JSON.parse(String(init?.body)) as {
      price: number;
      replay_price: number;
    };
    devicePrices.set('D1', { price: body.price, replayPrice: body.replay_price });
    deviceWriteCount += 1;
    return Response.json({ status: 'success' });
  }
  throw new Error(`Unexpected mock request: ${method} ${url.pathname}`);
};

const { getDevicePrices, setDeviceGamePrice } = await import(
  '../../apps/api/src/services/Mothership/devices.service'
);
const result = await setDeviceGamePrice('D1', gameId, {
  price: 120,
  replay_price: 40,
  scope: 'DEVICE',
});
const [row] = await getDevicePrices('D1');

assert.equal(deviceWriteCount, 1);
assert.deepEqual(result, {
  deviceId: 'D1',
  gameId,
  displayName: gameId,
  price: 120,
  replayPrice: 40,
  scope: 'DEVICE_GAME_OVERRIDE',
});
assert.ok(row);
assert.equal(row.basePrice, 120);
assert.equal(row.baseReplayPrice, 50);
assert.equal(row.effectivePrice, 120);
assert.equal(row.effectiveReplayPrice, 40);
assert.equal(row.hasOverride, true);
assert.equal(row.overrideReplayPrice, 40);
console.log('PASS device price: sparse per-device readback verified against unchanged catalog and fleet');
