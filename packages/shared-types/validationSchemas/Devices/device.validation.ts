import { z } from "zod";

/**
 * Device fleet and game pricing, as served by Mothership.
 *
 * Shapes below were established by reading the live host on 2026-10-12 and 2026-10-13 with
 * **read-only** requests:
 *   - `GET  /api/v1/kiosks/device-ids`                       → 9 devices
 *   - `GET  /api/v1/devices/{device_id}/prices`               → per-device prices; some
 *     responses include only `base_price` and `base_replay_price`, which are the returned
 *     device prices when effective/override fields are omitted
 *   - `GET  /api/v1/games`                                    → 16 catalog entries with price
 *
 * Prices are read per device. A write is requested in an explicit scope, because the two
 * achievable scopes are not equivalent:
 *   - `DEVICE`       the default: one device's override, verified against the catalog and
 *                    every other device. Mothership's per-device endpoint currently answers
 *                    2xx without persisting anything, so this scope can legitimately fail.
 *   - `GAME_CATALOG`  only after the operator confirms it: the game's catalog price, which
 *                    every kiosk offering that game charges.
 *
 * `scope` is therefore a required, explicit part of the request contract rather than a
 * fallback the server chooses on the caller's behalf: a global price change must never be
 * the silent result of a device-scoped request.
 * Resetting existing overrides uses Mothership's device-scoped reset endpoint.
 */

export const DeviceParamsSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
});

export const DeviceGameParamsSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  gameId: z.string().trim().min(1).max(120),
});

/** One device as reported by the Mothership device feed (raw upstream shape). */
const UpstreamDeviceSchema = z.object({
  device_id: z.string(),
  hardware_uuid: z.string().nullable().optional(),
  headscale_ip: z.string().nullable().optional(),
  is_online: z.boolean(),
  kiosk_number: z.number().nullable().optional(),
  last_seen: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  public_ip: z.string().nullable().optional(),
});

export const DeviceListResponseSchema = z.object({
  device_ids: z.array(z.string()),
  kiosks: z.array(UpstreamDeviceSchema),
  last_updated: z.string().nullable().optional(),
  total_kiosks: z.number(),
});

/** Normalize complete rows and sparse rows whose base fields carry the device prices. */
const UpstreamPriceSchema = z.object({
  base_price: z.number(),
  base_replay_price: z.number(),
  display_name: z.string(),
  effective_price: z.number().optional(),
  effective_replay_price: z.number().optional(),
  game_id: z.string(),
  has_override: z.union([z.number(), z.boolean()]).optional(),
  override_price: z.number().nullable().optional(),
  override_replay_price: z.number().nullable().optional(),
}).transform((row) => ({
  ...row,
  effective_price: row.effective_price ?? row.override_price ?? row.base_price,
  effective_replay_price:
    row.effective_replay_price ?? row.override_replay_price ?? row.base_replay_price,
  has_override:
    row.has_override ??
    (row.override_price != null || row.override_replay_price != null ? 1 : 0),
  override_price: row.override_price ?? null,
  override_replay_price: row.override_replay_price ?? null,
}));

export const DevicePricesResponseSchema = z.object({
  device_id: z.string(),
  pricing: z.array(UpstreamPriceSchema),
  status: z.string().optional(),
});

/**
 * Body for setting one game's price.
 *
 * The API maps these fields to Mothership per the requested `scope`:
 *   - `DEVICE` (default) → the per-device override endpoint on the device in the route.
 *   - `GAME_CATALOG`     → the game's catalog metadata endpoint, which reaches every kiosk.
 *     The client must send this explicitly, after telling the operator what it does.
 *
 * `replay_price` stays optional so an operator can change only the first-play price; the
 * upstream call omits the key entirely when undefined rather than sending null.
 */
export const SetDeviceGamePriceSchema = z.object({
  price: z.number().min(0, "Price cannot be negative").max(100000, "Price looks implausible"),
  replay_price: z
    .number()
    .min(0, "Replay price cannot be negative")
    .max(100000, "Replay price looks implausible")
    .optional(),
  scope: z.enum(['DEVICE', 'GAME_CATALOG']).optional().default('DEVICE'),
  /**
   * Write the device price now instead of staging it for the midnight EOD run.
   * Only meaningful for `DEVICE` scope; the catalog write is always immediate.
   */
  apply_now: z.boolean().optional(),
});

export type SetDeviceGamePriceInput = z.infer<typeof SetDeviceGamePriceSchema>;
export type PriceWriteScope = SetDeviceGamePriceInput['scope'];

/** Result returned after Mothership confirms a device-scoped override reset. */
export const ResetDevicePricesResultSchema = z.object({
  deviceId: z.string(),
  gamesReset: z.number().int().nonnegative(),
  scope: z.literal('DEVICE_OVERRIDES'),
});

export type ResetDevicePricesResult = z.infer<typeof ResetDevicePricesResultSchema>;

export const ResetAllDevicePricesResultSchema = z.object({
  devicesReset: z.number().int().nonnegative(),
  gamesReset: z.number().int().nonnegative(),
  scope: z.literal('ALL_DEVICE_OVERRIDES'),
});

export type ResetAllDevicePricesResult = z.infer<typeof ResetAllDevicePricesResultSchema>;

/** Result returned only after verifying the requested override and unchanged other devices. */
export const SetDeviceGamePriceResultSchema = z.object({
  deviceId: z.string(),
  gameId: z.string(),
  displayName: z.string(),
  price: z.number(),
  replayPrice: z.number(),
  /** What was actually written, so the caller can state the reach of the change honestly. */
  scope: z.enum(['DEVICE_GAME_OVERRIDE', 'GAME_CATALOG']),
  /** True when the write bypassed the EOD queue because the operator chose "Apply now". */
  appliedNow: z.boolean().optional(),
});

export type SetDeviceGamePriceResult = z.infer<typeof SetDeviceGamePriceResultSchema>;

/**
 * One game catalog entry as Mothership returns it from `GET /api/v1/games`.
 *
 * This is the pricing every kiosk offering the game charges, and the value a
 * `GAME_CATALOG` write is verified against.
 */
const UpstreamCatalogGameSchema = z.object({
  game_id: z.string(),
  display_name: z.string(),
  price: z.number(),
  replay_price: z.number(),
});

export const GameCatalogResponseSchema = z.object({
  games: z.array(UpstreamCatalogGameSchema),
});

/** One upstream catalog entry (`GET /api/v1/games`), as parsed by the schema above. */
export type UpstreamCatalogGame = z.infer<typeof UpstreamCatalogGameSchema>;

/** A device as this API returns it (normalised, camelCase). */
export const DeviceViewSchema = z.object({
  deviceId: z.string(),
  hardwareUuid: z.string().nullable(),
  headscaleIp: z.string().nullable(),
  isOnline: z.boolean(),
  kioskNumber: z.number().nullable(),
  lastSeen: z.string().nullable(),
  location: z.string().nullable(),
  publicIp: z.string().nullable(),
});

/**
 * A game's price with duplicate upstream rows collapsed.
 *
 * Mothership returns each game twice — once keyed with spaces ("Brick Blast", priced)
 * and once with underscores ("Brick_Blast", always 0.0). Left alone, every game appears
 * twice in the UI and the zero row is the one an operator would click. The service
 * merges them and keeps the priced row, so `gameId` here is the id that actually carries
 * a price and is therefore the id to write back with.
 */
export const GamePriceViewSchema = z.object({
  gameId: z.string(),
  displayName: z.string(),
  basePrice: z.number(),
  baseReplayPrice: z.number(),
  effectivePrice: z.number(),
  effectiveReplayPrice: z.number(),
  hasOverride: z.boolean(),
  overridePrice: z.number().nullable(),
  overrideReplayPrice: z.number().nullable(),
  /** Number of upstream rows collapsed into this one (1 = no duplicates). */
  mergedRows: z.number(),
  /**
   * The device charges something other than the catalog price. This is drift, not an
   * override: a device reset cannot clear it, so it must never feed reset verification.
   */
  differsFromCatalog: z.boolean(),
  iconUrl: z.string().url().nullable(),
  imageUrl: z.string().url().nullable(),
});

export type DeviceView = z.infer<typeof DeviceViewSchema>;
export type GamePriceView = z.infer<typeof GamePriceViewSchema>;

const LauncherGameSchema = z.object({
  GameId: z.string(),
  GameName: z.string(),
  IconUrl: z.string(),
  PosterUrl: z.string(),
  isplayable: z.boolean(),
  price: z.number(),
  replayprice: z.number(),
  version: z.number(),
});

export const LauncherGamesResponseSchema = z.object({
  games: z.array(LauncherGameSchema),
  coming_soon: z.array(LauncherGameSchema),
});

export type LauncherGame = z.infer<typeof LauncherGameSchema>;
