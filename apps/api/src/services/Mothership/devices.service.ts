import { ApiError } from '../../utils/ApiError';
import {
  DeviceListResponseSchema,
  DevicePricesResponseSchema,
  GameCatalogResponseSchema,
  type DeviceView,
  type GamePriceView,
  type ResetDevicePricesResult,
  type SetDeviceGamePriceInput,
  type SetDeviceGamePriceResult,
  type UpstreamCatalogGame,
} from '@shared-types/validationSchemas/Devices/device.validation';

/**
 * Client for Mothership's device fleet and per-device game pricing.
 *
 * This API stores no pricing of its own — pricing lives entirely in Mothership — so this
 * module only proxies. Price mutations are gated to Company OWNER/ADMIN.
 *
 * The read endpoints were confirmed live on 2026-10-12 with **read-only** requests:
 *   - `GET  /api/v1/kiosks/device-ids`                          → 9 devices
 *   - `GET  /api/v1/devices/{device_id}/prices`                  → 16 rows per device; some
 *     responses expose the device's current prices only as `base_price`/`base_replay_price`
 *
 * The per-device write contract was confirmed live on 2026-10-13, on one offline device:
 * `POST /api/v1/devices/{device_id}/games/{game_id}/price` persists a per-device override
 * only when the body uses `{ price, replay_price }`. The same request carrying
 * `{ override_price, override_replay_price }` answers 200 `{"status":"success"}` while
 * echoing the *existing* price and saving nothing — the keys were the whole defect, so a
 * "success" response is never trusted on its own.
 *
 * Price writes and resets use Mothership's device-scoped endpoints by default. A device
 * write is confirmed by re-reading the selected device and checking that the global catalog
 * and all other devices remain unchanged, so a silently-ignored write is caught instead of
 * reported as success.
 * A caller may instead request the explicit `GAME_CATALOG` scope, which updates the game's
 * catalog price (every kiosk offering the game) and is confirmed against
 * `GET /api/v1/games`. A device-scoped request never falls back to the catalog endpoint.
 */

const REQUEST_TIMEOUT_MS = 15000;
const UPSTREAM_BODY_LIMIT = 1200;

function tidyBody(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > UPSTREAM_BODY_LIMIT
    ? `${collapsed.slice(0, UPSTREAM_BODY_LIMIT)}… (truncated)`
    : collapsed;
}

/**
 * Origin of the Mothership host.
 *
 * Mirrors `gateways.service.ts`, including its tolerance for the misnamed
 * `MOTHERSHIP_TRANSACTION_URL` (no `_API_`) that a live deployment actually uses. Without
 * that fallback these routes answer 503 on a deployment whose config is otherwise fine.
 */
function mothershipOrigin(): string {
  const explicit = process.env.MOTHERSHIP_DEVICE_API_URL;
  const source =
    explicit ??
    process.env.MOTHERSHIP_TRANSACTION_API_URL ??
    process.env.MOTHERSHIP_TRANSACTION_URL;
  if (!source) {
    throw new ApiError(503, 'Mothership device API is not configured');
  }
  return new URL(source).origin;
}

async function callMothership(
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const url = `${mothershipOrigin()}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const adminKey = process.env.MOTHERSHIP_ADMIN_API_KEY;
  if (adminKey) headers['X-Admin-Api-Key'] = adminKey;

  let response: Response;
  try {
    const init2: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (init.body !== undefined) init2.body = JSON.stringify(init.body);
    response = await fetch(url, init2);
  } catch (error) {
    throw new ApiError(
      502,
      `Mothership device API unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  let parsedAsJson = false;
  if (text) {
    try {
      payload = JSON.parse(text);
      parsedAsJson = true;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = tidyBody(text);
    console.error('[mothership-devices] upstream rejected request', {
      method: init.method,
      path,
      upstreamStatus: response.status,
      upstreamBody: body || '(empty body)',
    });
    throw new ApiError(
      response.status >= 500 ? 502 : 400,
      `Mothership device API rejected the request (HTTP ${response.status})`,
      { upstreamStatus: response.status, upstreamBody: body || null },
    );
  }

  if (!parsedAsJson && text) {
    throw new ApiError(502, 'Mothership device API returned a non-JSON response', {
      upstreamStatus: response.status,
      upstreamBody: tidyBody(text),
    });
  }

  return payload;
}

export async function listDevices(): Promise<{ devices: DeviceView[]; lastUpdated: string | null }> {
  const payload = await callMothership('/api/v1/kiosks/device-ids', { method: 'GET' });
  const parsed = DeviceListResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership device API returned an unexpected device payload');
  }
  const devices = parsed.data.kiosks.map((device) => ({
    deviceId: device.device_id,
    hardwareUuid: device.hardware_uuid ?? null,
    headscaleIp: device.headscale_ip ?? null,
    isOnline: device.is_online,
    kioskNumber: device.kiosk_number ?? null,
    lastSeen: device.last_seen ?? null,
    location: device.location ?? null,
    publicIp: device.public_ip ?? null,
  }));
  return { devices, lastUpdated: parsed.data.last_updated ?? null };
}

/** `has_override` arrives as 0/1; normalise to a real boolean. */
const toBool = (value: number | boolean): boolean => value === true || value === 1;

/**
 * Merge Mothership's duplicate rows.
 *
 * Every game comes back twice: a spaced `game_id` with the real price ("Brick Blast",
 * 115.0) and an underscored twin that is always 0.0 ("Brick_Blast"). Returning both
 * would show each game twice and put the zero row in front of the operator, and writing
 * a price back needs the id that actually holds the price.
 *
 * The merge is keyed on `display_name`, which is identical across the pair, and the
 * priced row wins. A game whose rows are all zero keeps its first id: dropping it would
 * hide a game that exists but is unpriced, which is a real state an operator needs to see.
 */
function mergeGamePrices(
  rows: {
    base_price: number;
    base_replay_price: number;
    display_name: string;
    effective_price: number;
    effective_replay_price: number;
    game_id: string;
    has_override: number | boolean;
    override_price: number | null;
    override_replay_price: number | null;
  }[],
): GamePriceView[] {
  const byName = new Map<string, { row: (typeof rows)[number]; count: number }>();
  for (const row of rows) {
    const existing = byName.get(row.display_name);
    if (!existing) {
      byName.set(row.display_name, { row, count: 1 });
      continue;
    }
    existing.count += 1;
    // Prefer the row that carries a price or an explicit override; keep the incumbent
    // otherwise, so ordering in the response cannot change which id is surfaced.
    const better =
      (row.effective_price > 0 && existing.row.effective_price <= 0) ||
      (toBool(row.has_override) && !toBool(existing.row.has_override));
    if (better) existing.row = row;
  }
  return [...byName.values()].map(({ row, count }) => ({
    gameId: row.game_id,
    displayName: row.display_name,
    basePrice: row.base_price,
    baseReplayPrice: row.base_replay_price,
    effectivePrice: row.effective_price,
    effectiveReplayPrice: row.effective_replay_price,
    hasOverride: toBool(row.has_override),
    overridePrice: row.override_price,
    overrideReplayPrice: row.override_replay_price,
    mergedRows: count,
  }));
}

export async function getDevicePrices(
  deviceId: string,
  catalogSnapshot?: UpstreamCatalogGame[],
): Promise<GamePriceView[]> {
  const payload = await callMothership(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/prices`,
    { method: 'GET' },
  );
  const parsed = DevicePricesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership device API returned an unexpected pricing payload');
  }
  const catalog = catalogSnapshot ?? (await getGameCatalog());
  return mergeGamePrices(parsed.data.pricing).map((game) => {
    const catalogGame = findCatalogGame(catalog, game);
    if (!catalogGame) return game;

    const differsFromCatalog =
      !samePrice(game.effectivePrice, catalogGame.price) ||
      !samePrice(game.effectiveReplayPrice, catalogGame.replay_price);
    return {
      ...game,
      basePrice: catalogGame.price,
      baseReplayPrice: catalogGame.replay_price,
      hasOverride: game.hasOverride || differsFromCatalog,
      overridePrice: game.overridePrice ?? (differsFromCatalog ? game.effectivePrice : null),
      overrideReplayPrice:
        game.overrideReplayPrice ??
        (differsFromCatalog ? game.effectiveReplayPrice : null),
    };
  });
}

/** Prices survive as floats; compare with a tolerance far below one paisa. */
const PRICE_EPSILON = 0.001;

const samePrice = (a: number, b: number): boolean => Math.abs(a - b) < PRICE_EPSILON;

function hasPriceOverride(game: GamePriceView): boolean {
  return (
    game.hasOverride ||
    game.overridePrice !== null ||
    game.overrideReplayPrice !== null ||
    !samePrice(game.effectivePrice, game.basePrice) ||
    !samePrice(game.effectiveReplayPrice, game.baseReplayPrice)
  );
}

function sameDevicePrices(before: GamePriceView[], after: GamePriceView[]): boolean {
  if (before.length !== after.length) return false;
  const sortedBefore = [...before].sort((a, b) => a.gameId.localeCompare(b.gameId));
  const sortedAfter = [...after].sort((a, b) => a.gameId.localeCompare(b.gameId));
  return sortedBefore.every((game, index) => {
    const observed = sortedAfter[index];
    return (
      observed !== undefined &&
      game.gameId === observed.gameId &&
      game.displayName === observed.displayName &&
      game.hasOverride === observed.hasOverride &&
      samePrice(game.basePrice, observed.basePrice) &&
      samePrice(game.baseReplayPrice, observed.baseReplayPrice) &&
      samePrice(game.effectivePrice, observed.effectivePrice) &&
      samePrice(game.effectiveReplayPrice, observed.effectiveReplayPrice) &&
      (game.overridePrice === null
        ? observed.overridePrice === null
        : observed.overridePrice !== null && samePrice(game.overridePrice, observed.overridePrice)) &&
      (game.overrideReplayPrice === null
        ? observed.overrideReplayPrice === null
        : observed.overrideReplayPrice !== null &&
          samePrice(game.overrideReplayPrice, observed.overrideReplayPrice))
    );
  });
}

/** Resolve an operator-facing game reference: the id first, then the display name. */
function findGameOnDevice(games: GamePriceView[], gameId: string): GamePriceView | undefined {
  return (
    games.find((game) => game.gameId === gameId) ??
    games.find((game) => game.displayName === gameId)
  );
}

/** Match a device price row to the catalog entry that carries the fleet-wide price. */
function findCatalogGame(
  catalog: UpstreamCatalogGame[],
  game: GamePriceView,
): UpstreamCatalogGame | undefined {
  return (
    catalog.find((entry) => entry.game_id === game.gameId) ??
    catalog.find((entry) => entry.display_name === game.displayName)
  );
}

/**
 * Read Mothership's game catalog (`GET /api/v1/games`).
 *
 * The catalog holds the price kiosks charge by default and is the readback a `GAME_CATALOG`
 * write is verified against. Confirmed live on 2026-10-13 with a read-only request: 16
 * catalog entries carrying `price` and `replay_price`.
 */
async function getGameCatalog(): Promise<UpstreamCatalogGame[]> {
  const payload = await callMothership('/api/v1/games', { method: 'GET' });
  const parsed = GameCatalogResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership device API returned an unexpected catalog payload');
  }
  return parsed.data.games;
}

/** Compare only catalog prices; metadata such as downloads is irrelevant to price scope. */
function sameCatalogPrices(
  before: UpstreamCatalogGame[],
  after: UpstreamCatalogGame[],
): boolean {
  if (before.length !== after.length) return false;
  const sortedBefore = [...before].sort((a, b) => a.game_id.localeCompare(b.game_id));
  const sortedAfter = [...after].sort((a, b) => a.game_id.localeCompare(b.game_id));
  return sortedBefore.every((game, index) => {
    const observed = sortedAfter[index];
    return (
      observed !== undefined &&
      game.game_id === observed.game_id &&
      samePrice(game.price, observed.price) &&
      samePrice(game.replay_price, observed.replay_price)
    );
  });
}

/**
 * Reset all price overrides on one device.
 *
 * The upstream reset endpoint is device-scoped. Do not call it when there is nothing to
 * reset; otherwise, snapshot every device before the reset, then verify the selected device
 * returned to catalog prices and all other devices remained unchanged.
 */
export async function resetDevicePrices(deviceId: string): Promise<ResetDevicePricesResult> {
  const [{ devices }, catalogBefore] = await Promise.all([listDevices(), getGameCatalog()]);
  const deviceIds = [...new Set(devices.map((device) => device.deviceId))];
  if (!deviceIds.includes(deviceId)) {
    throw new ApiError(404, 'Mothership device was not found', { deviceId });
  }

  const before = new Map(
    await Promise.all(
      deviceIds.map(async (id) => [id, await getDevicePrices(id, catalogBefore)] as const),
    ),
  );
  const targetBefore = before.get(deviceId);
  if (!targetBefore) {
    throw new ApiError(502, 'Could not read selected device prices before reset', { deviceId });
  }

  const gamesReset = targetBefore.filter(hasPriceOverride).length;

  if (gamesReset === 0) {
    return { deviceId, gamesReset, scope: 'DEVICE_OVERRIDES' };
  }

  await callMothership(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/prices/reset`,
    { method: 'POST' },
  );

  const catalogAfter = await getGameCatalog();
  if (!sameCatalogPrices(catalogBefore, catalogAfter)) {
    throw new ApiError(502, 'Reset changed catalog prices', { deviceId });
  }
  const after = new Map(
    await Promise.all(
      deviceIds.map(async (id) => [id, await getDevicePrices(id, catalogAfter)] as const),
    ),
  );
  const targetAfter = after.get(deviceId);
  if (!targetAfter) {
    throw new ApiError(502, 'Could not verify selected device prices after reset', { deviceId });
  }

  const remainingOverrides = targetAfter.filter(hasPriceOverride);

  if (remainingOverrides.length > 0) {
    throw new ApiError(502, 'Mothership did not reset all device price overrides', {
      deviceId,
      remainingOverrides: remainingOverrides.map((game) => game.gameId),
    });
  }

  const changedDevices: string[] = [];
  for (const id of deviceIds) {
    if (id === deviceId) continue;
    const beforePrices = before.get(id);
    const afterPrices = after.get(id);
    if (!beforePrices || !afterPrices) {
      throw new ApiError(502, 'Could not verify another device price snapshot after reset', {
        deviceId,
        otherDeviceId: id,
      });
    }
    if (!sameDevicePrices(beforePrices, afterPrices)) changedDevices.push(id);
  }
  if (changedDevices.length > 0) {
    throw new ApiError(502, 'Reset changed pricing on other devices', {
      deviceId,
      changedDevices,
    });
  }

  return { deviceId, gamesReset, scope: 'DEVICE_OVERRIDES' };
}

/**
 * Update one game's catalog price — every kiosk offering the game picks it up.
 *
 * Only reachable through an explicit `scope: 'GAME_CATALOG'` request; nothing calls this as
 * a fallback for a device-scoped write. The write goes to Mothership's catalog metadata
 * endpoint (the route its own dashboard uses), and success is reported only after
 * `GET /api/v1/games` reads the requested values back. The catalog readback is the
 * authoritative confirmation; per-device overrides are separate state and may mask the new
 * catalog price on an individual device.
 */
async function setGameCatalogPrice(
  deviceId: string,
  gameId: string,
  input: SetDeviceGamePriceInput,
): Promise<SetDeviceGamePriceResult> {
  const { devices } = await listDevices();
  const deviceIds = [...new Set(devices.map((device) => device.deviceId))];
  if (!deviceIds.includes(deviceId)) {
    throw new ApiError(404, 'Mothership device was not found', { deviceId });
  }

  // The operator acts from a device price row; resolve it to learn which game this is, then
  // map that row onto the catalog entry that actually carries the fleet-wide price.
  const targetPrices = await getDevicePrices(deviceId);
  const gameOnDevice = findGameOnDevice(targetPrices, gameId);
  if (!gameOnDevice) {
    throw new ApiError(404, 'Game was not found on the selected device', { deviceId, gameId });
  }

  const catalogBefore = await getGameCatalog();
  const catalogGame = findCatalogGame(catalogBefore, gameOnDevice);
  if (!catalogGame) {
    throw new ApiError(404, "Game was not found in Mothership's catalog", {
      deviceId,
      gameId: gameOnDevice.gameId,
      displayName: gameOnDevice.displayName,
    });
  }

  const body: { price: number; replay_price?: number } = { price: input.price };
  if (input.replay_price !== undefined) body.replay_price = input.replay_price;

  await callMothership(`/api/v1/games/${encodeURIComponent(catalogGame.game_id)}/metadata`, {
    method: 'POST',
    body,
  });

  const catalogAfter = await getGameCatalog();
  const confirmed = catalogAfter.find((entry) => entry.game_id === catalogGame.game_id);
  const replayPrice = input.replay_price ?? catalogGame.replay_price;
  const catalogVerified =
    !!confirmed &&
    samePrice(confirmed.price, input.price) &&
    samePrice(confirmed.replay_price, replayPrice);

  if (!catalogVerified || !confirmed) {
    throw new ApiError(502, 'Mothership did not apply and verify the catalog price', {
      deviceId,
      gameId: catalogGame.game_id,
      requested: { price: input.price, replayPrice },
      observed: confirmed
        ? {
            price: confirmed.price,
            replayPrice: confirmed.replay_price,
            displayName: confirmed.display_name,
          }
        : null,
      catalogEntryFound: !!confirmed,
    });
  }

  return {
    deviceId,
    gameId: confirmed.game_id,
    displayName: confirmed.display_name,
    price: confirmed.price,
    replayPrice: confirmed.replay_price,
    scope: 'GAME_CATALOG',
  };
}

/**
 * Set one game's price in the explicitly requested scope.
 *
 * `DEVICE` (the default) writes a device-only override and verifies it against the catalog
 * and every other device. `GAME_CATALOG` — never inferred, only honoured when the caller
 * asks for it — updates the game's catalog price. A device-scoped request and a catalog
 * request never substitute for one another.
 */
export async function setDeviceGamePrice(
  deviceId: string,
  gameId: string,
  input: SetDeviceGamePriceInput,
): Promise<SetDeviceGamePriceResult> {
  if (input.scope === 'GAME_CATALOG') {
    return setGameCatalogPrice(deviceId, gameId, input);
  }

  const [{ devices }, catalogBefore] = await Promise.all([listDevices(), getGameCatalog()]);
  const deviceIds = [...new Set(devices.map((device) => device.deviceId))];
  if (!deviceIds.includes(deviceId)) {
    throw new ApiError(404, 'Mothership device was not found', { deviceId });
  }

  const before = new Map(
    await Promise.all(
      deviceIds.map(async (id) => [id, await getDevicePrices(id, catalogBefore)] as const),
    ),
  );
  const targetBefore = before.get(deviceId);
  if (!targetBefore) {
    throw new ApiError(502, 'Could not read selected device prices before update', { deviceId });
  }

  const gameBefore = findGameOnDevice(targetBefore, gameId);
  if (!gameBefore) {
    throw new ApiError(404, 'Game was not found on the selected device', { deviceId, gameId });
  }
  const catalogGameBefore = findCatalogGame(catalogBefore, gameBefore);
  if (!catalogGameBefore) {
    throw new ApiError(404, "Game was not found in Mothership's catalog", {
      deviceId,
      gameId: gameBefore.gameId,
      displayName: gameBefore.displayName,
    });
  }

  // Confirmed live 2026-10-13: this endpoint reads `price` / `replay_price`. The
  // `override_price` / `override_replay_price` keys this used to send are accepted with
  // 200 "success" and then ignored, which is what made device-scoped pricing look like an
  // unsupported upstream feature.
  const body: { price: number; replay_price?: number } = {
    price: input.price,
  };
  if (input.replay_price !== undefined) {
    body.replay_price = input.replay_price;
  }

  await callMothership(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/games/${encodeURIComponent(gameBefore.gameId)}/price`,
    { method: 'POST', body },
  );

  const [devicesAfter, catalogAfter] = await Promise.all([
    listDevices(),
    getGameCatalog(),
  ]);
  const afterRows = await Promise.all(
    deviceIds.map(async (id) => [id, await getDevicePrices(id, catalogAfter)] as const),
  );
  const after = new Map(afterRows);
  const catalogUnchanged = sameCatalogPrices(catalogBefore, catalogAfter);
  const catalogGameAfter = catalogAfter.find(
    (game) => game.game_id === catalogGameBefore.game_id,
  );
  const deviceIdsAfter = [...new Set(devicesAfter.devices.map((device) => device.deviceId))].sort();
  const expectedDeviceIds = [...deviceIds].sort();
  const fleetChanged = JSON.stringify(deviceIdsAfter) !== JSON.stringify(expectedDeviceIds);
  const targetAfter = after.get(deviceId);
  if (!targetAfter) {
    throw new ApiError(502, 'Could not verify selected device prices after update', { deviceId });
  }

  const gameAfter = findGameOnDevice(targetAfter, gameId);
  const replayPrice = input.replay_price ?? gameBefore.effectiveReplayPrice;
  const targetValuesVerified =
    !!gameAfter &&
    samePrice(gameAfter.effectivePrice, input.price) &&
    samePrice(gameAfter.effectiveReplayPrice, replayPrice);
  // In sparse responses `base_*` is the selected device's writable price, not the
  // catalog. Verify it through the normalized effective values, then independently
  // confirm the global catalog and every other device stayed unchanged.
  const targetVerified = targetValuesVerified && catalogUnchanged;

  const changedDevices: string[] = [];
  for (const id of deviceIds) {
    const beforePrices = before.get(id);
    const afterPrices = after.get(id);
    if (!beforePrices || !afterPrices) {
      throw new ApiError(502, 'Could not verify a device price snapshot after update', {
        deviceId,
        otherDeviceId: id,
      });
    }

    const unchanged = id === deviceId
      ? sameDevicePrices(
          beforePrices.filter((game) => game.gameId !== gameBefore.gameId),
          afterPrices.filter((game) => game.gameId !== gameBefore.gameId),
        )
      : sameDevicePrices(beforePrices, afterPrices);
    if (!unchanged) changedDevices.push(id);
  }

  if (!targetVerified || changedDevices.length > 0 || fleetChanged) {
    const failureMessage = !catalogUnchanged
      ? 'Mothership changed catalog prices during a device-scoped update'
      : targetVerified
        ? 'Mothership changed pricing outside the selected device, so the update was not verified as device-only'
        : 'Mothership did not confirm the requested device prices in its readback';
    throw new ApiError(
      502,
      failureMessage,
      {
        deviceId,
        gameId: gameBefore.gameId,
        targetVerified,
        targetValuesVerified,
        catalogUnchanged,
        fleetChanged,
        deviceIdsAfter,
        requested: { price: input.price, replayPrice },
        observed: gameAfter
          ? {
              price: gameAfter.effectivePrice,
              replayPrice: gameAfter.effectiveReplayPrice,
              hasOverride: gameAfter.hasOverride,
              overridePrice: gameAfter.overridePrice,
              overrideReplayPrice: gameAfter.overrideReplayPrice,
              basePrice: gameAfter.basePrice,
              baseReplayPrice: gameAfter.baseReplayPrice,
              catalogPrice: catalogGameAfter?.price ?? null,
              catalogReplayPrice: catalogGameAfter?.replay_price ?? null,
            }
          : null,
        changedDevices,
      },
    );
  }

  if (!gameAfter) {
    throw new ApiError(502, 'Updated game was missing from the selected device readback', {
      deviceId,
      gameId: gameBefore.gameId,
    });
  }

  return {
    deviceId,
    gameId: gameAfter.gameId,
    displayName: gameAfter.displayName,
    price: gameAfter.effectivePrice,
    replayPrice: gameAfter.effectiveReplayPrice,
    scope: 'DEVICE_GAME_OVERRIDE',
  };
}
