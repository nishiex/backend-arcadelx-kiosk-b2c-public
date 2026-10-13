// Per-device vs catalog price scopes (Option C): mocked Mothership only, no live calls.
// Run from the repo root:
//   npx tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/device-pricing-scope-check.ts
import assert from "node:assert/strict";
import { ApiError } from "../src/utils/ApiError";
import { setDeviceGamePrice } from "../src/services/Mothership/devices.service";

const ORIGIN = "https://mothership.test";
const GAME_ID = "Brick Blast";

const originalFetch = globalThis.fetch;
const originalDeviceUrl = process.env.MOTHERSHIP_DEVICE_API_URL;
const originalTransactionUrl = process.env.MOTHERSHIP_TRANSACTION_API_URL;
// Pin the origin `mothershipOrigin()` resolves; an explicit device URL wins over the rest.
process.env.MOTHERSHIP_DEVICE_API_URL = `${ORIGIN}/api/v1/devices`;
delete process.env.MOTHERSHIP_TRANSACTION_API_URL;

type Call = { url: string; method: string; body?: string };
const calls: Call[] = [];

// Mock Mothership state. The live per-device price endpoint persists an override when the
// body uses `{ price, replay_price }` (confirmed 2026-10-13). `deviceOverridePersists =
// false` reproduces the regression this service must still catch -- a write that is accepted
// and persisted by nobody -- while `true` mirrors the confirmed live contract.
let deviceOverridePersists = false;
let catalogWriteApplies = false;

const deviceIds = ["D1", "D2"] as const;
type DeviceId = (typeof deviceIds)[number];

type GameState = {
  basePrice: number;
  baseReplayPrice: number;
  overridePrice: number | null;
  overrideReplayPrice: number | null;
};

const deviceGames = new Map<DeviceId, Map<string, GameState>>();
const catalogGames = new Map<string, { price: number; replayPrice: number }>();

function resetState(): void {
  deviceGames.clear();
  catalogGames.clear();
  for (const id of deviceIds) {
    deviceGames.set(
      id,
      new Map([
        [GAME_ID, { basePrice: 100, baseReplayPrice: 50, overridePrice: null, overrideReplayPrice: null }],
      ]),
    );
  }
  catalogGames.set(GAME_ID, { price: 100, replayPrice: 50 });
  calls.length = 0;
}

function deviceState(id: DeviceId): Map<string, GameState> {
  const state = deviceGames.get(id);
  assert.ok(state, `mock state for ${id} is missing`);
  return state;
}

function priceRow(id: DeviceId) {
  const game = deviceState(id).get(GAME_ID);
  assert.ok(game, "mock game state is missing");
  const overridePrice = game.overridePrice;
  const overrideReplayPrice = game.overrideReplayPrice;
  return {
    base_price: game.basePrice,
    base_replay_price: game.baseReplayPrice,
    display_name: GAME_ID,
    effective_price: overridePrice !== null ? overridePrice : game.basePrice,
    effective_replay_price:
      overridePrice !== null && overrideReplayPrice !== null ? overrideReplayPrice : game.baseReplayPrice,
    game_id: GAME_ID,
    has_override: overridePrice !== null ? 1 : 0,
    override_price: overridePrice,
    override_replay_price: overrideReplayPrice,
  };
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const bodyText = typeof init?.body === "string" ? init.body : undefined;
  calls.push(
    bodyText === undefined
      ? { url: url.toString(), method }
      : { url: url.toString(), method, body: bodyText },
  );
  const path = decodeURIComponent(url.pathname);

  if (method === "GET" && path === "/api/v1/kiosks/device-ids") {
    return Response.json({
      device_ids: [...deviceIds],
      kiosks: deviceIds.map((id) => ({ device_id: id, is_online: true })),
      last_updated: "2026-10-13T00:00:00Z",
      total_kiosks: deviceIds.length,
    });
  }

  if (method === "GET") {
    const priceRead = /^\/api\/v1\/devices\/([^/]+)\/prices$/.exec(path);
    if (priceRead) {
      const id = priceRead[1] as DeviceId;
      return Response.json({ device_id: id, pricing: [priceRow(id)], status: "success" });
    }
  }

  if (method === "GET" && path === "/api/v1/games") {
    return Response.json({
      games: [...catalogGames.entries()].map(([gameId, entry]) => ({
        game_id: gameId,
        display_name: gameId,
        price: entry.price,
        replay_price: entry.replayPrice,
      })),
    });
  }

  if (method === "POST") {
    const deviceWrite = /^\/api\/v1\/devices\/([^/]+)\/games\/(.+)\/price$/.exec(path);
    if (deviceWrite) {
      const game = deviceState(deviceWrite[1] as DeviceId).get(GAME_ID);
      assert.ok(game, "mock game state is missing");
      const body = JSON.parse(bodyText ?? "{}") as { price?: number; replay_price?: number };
      if (deviceOverridePersists) {
        if (typeof body.price === "number") game.overridePrice = body.price;
        if (typeof body.replay_price === "number") game.overrideReplayPrice = body.replay_price;
      }
      return Response.json({ status: "success" });
    }
    if (path.startsWith("/api/v1/games/") && path.endsWith("/metadata")) {
      const entry = catalogGames.get(GAME_ID);
      assert.ok(entry, "mock catalog state is missing");
      const body = JSON.parse(bodyText ?? "{}") as { price?: number; replay_price?: number };
      if (catalogWriteApplies) {
        if (typeof body.price === "number") entry.price = body.price;
        if (typeof body.replay_price === "number") entry.replayPrice = body.replay_price;
      }
      return Response.json({ message: "Metadata saved" });
    }
  }

  throw new Error(`Unexpected mocked request: ${method} ${path}`);
};

try {
  // Case 1 -- DEVICE scope when the upstream accepts the write and persists nothing: the
  // request must fail clearly and must not fall back to the catalog.
  resetState();
  deviceOverridePersists = false;
  catalogWriteApplies = false;
  let deviceFailure: unknown;
  try {
    await setDeviceGamePrice("D1", GAME_ID, { price: 150, replay_price: 60, scope: "DEVICE" });
  } catch (error) {
    deviceFailure = error;
  }
  assert.ok(deviceFailure instanceof ApiError, "a no-persist device write must reject");
  assert.equal(deviceFailure.statusCode, 502);
  assert.match(deviceFailure.message, /did not confirm a device price override/);
  assert.match(deviceFailure.message, /no price change was verified/);
  assert.equal((deviceFailure.errors as { targetVerified?: boolean } | null)?.targetVerified, false);
  const deviceWrites = calls.filter((call) => call.method === "POST" && call.url.includes("/devices/"));
  assert.equal(deviceWrites.length, 1, "the device override endpoint is attempted exactly once");
  assert.deepEqual(JSON.parse(deviceWrites[0]?.body ?? "{}"), {
    price: 150,
    replay_price: 60,
  });
  assert.equal(
    calls.filter((call) => call.url.includes("/api/v1/games")).length,
    0,
    "device scope must not touch the catalog",
  );
  console.log("PASS device scope: an unpersisted write fails clearly and never touches the catalog");

  // Case 2 -- DEVICE scope with the endpoint behaving as confirmed live: the override is
  // verified through the read-back, still without reading or writing the catalog.
  resetState();
  deviceOverridePersists = true;
  const deviceResult = await setDeviceGamePrice("D1", GAME_ID, { price: 150, replay_price: 60, scope: "DEVICE" });
  assert.equal(deviceResult.scope, "DEVICE_GAME_OVERRIDE");
  assert.equal(deviceResult.price, 150);
  assert.equal(deviceResult.replayPrice, 60);
  assert.equal(
    calls.filter((call) => call.url.includes("/api/v1/games")).length,
    0,
    "device scope must not read the catalog",
  );
  console.log("PASS device scope: a persisted override is read back and verified");

  // Case 3 — explicit GAME_CATALOG scope: the catalog metadata endpoint is written, and
  // success is only reported after a later catalog read confirms the requested values.
  resetState();
  catalogWriteApplies = true;
  const catalogResult = await setDeviceGamePrice("D1", GAME_ID, { price: 101, replay_price: 50.5, scope: "GAME_CATALOG" });
  assert.equal(catalogResult.scope, "GAME_CATALOG");
  assert.equal(catalogResult.price, 101);
  assert.equal(catalogResult.replayPrice, 50.5);
  const metadataPost = calls.find(
    (call) => call.method === "POST" && call.url.endsWith(`/api/v1/games/${encodeURIComponent(GAME_ID)}/metadata`),
  );
  assert.ok(metadataPost, "the catalog metadata endpoint must be written");
  assert.deepEqual(JSON.parse(metadataPost.body ?? "{}"), { price: 101, replay_price: 50.5 });
  assert.equal(
    calls.filter((call) => call.method === "POST" && call.url.includes("/devices/")).length,
    0,
    "catalog scope must not write the device endpoint",
  );
  const metadataIndex = calls.indexOf(metadataPost);
  const lastCatalogReadIndex = calls.reduce(
    (acc, call, index) => (call.method === "GET" && call.url.endsWith("/api/v1/games") ? index : acc),
    -1,
  );
  assert.ok(lastCatalogReadIndex > metadataIndex, "the catalog write is confirmed by a later catalog read");
  console.log("PASS catalog scope: explicit write verified through the catalog read-back; device endpoint untouched");

  // Case 4 — explicit GAME_CATALOG scope when the write does not stick: success is withheld.
  resetState();
  catalogWriteApplies = false;
  let catalogFailure: unknown;
  try {
    await setDeviceGamePrice("D1", GAME_ID, { price: 101, replay_price: 50.5, scope: "GAME_CATALOG" });
  } catch (error) {
    catalogFailure = error;
  }
  assert.ok(catalogFailure instanceof ApiError, "an unverified catalog write must reject");
  assert.equal(catalogFailure.statusCode, 502);
  assert.match(catalogFailure.message, /did not apply and verify the catalog price/);
  assert.equal(
    (catalogFailure.errors as { observed?: { price?: number } | null } | null)?.observed?.price,
    100,
  );
  console.log("PASS catalog scope: success is withheld until the catalog read-back matches");
} finally {
  globalThis.fetch = originalFetch;
  if (originalDeviceUrl === undefined) {
    delete process.env.MOTHERSHIP_DEVICE_API_URL;
  } else {
    process.env.MOTHERSHIP_DEVICE_API_URL = originalDeviceUrl;
  }
  if (originalTransactionUrl === undefined) {
    delete process.env.MOTHERSHIP_TRANSACTION_API_URL;
  } else {
    process.env.MOTHERSHIP_TRANSACTION_API_URL = originalTransactionUrl;
  }
}
