import { z } from "zod";

/**
 * Device fleet and per-device game pricing, as served by Mothership.
 *
 * Shapes below were established by reading the live host on 2026-10-12 with
 * **read-only** requests:
 *   - `GET  /api/v1/kiosks/device-ids`                       → 9 devices
 *   - `GET  /api/v1/devices/{device_id}/prices`               → 30 rows (15 games × 2)
 *   - `POST /api/v1/devices/{device_id}/games/{game_id}/price`
 *
 * IMPORTANT — the write contract is NOT verified. The POST response echoes
 * `{ price, replay_price }`, so those are the field names used, but no successful
 * write was performed against production to confirm them (deliberately: probing a
 * write endpoint on a live fleet is not worth the risk). Treat the body shape as
 * inferred until a real, intentional write confirms it.
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

/** One raw pricing row. `has_override` arrives as 0/1, so accept number or boolean. */
const UpstreamPriceSchema = z.object({
  base_price: z.number(),
  base_replay_price: z.number(),
  display_name: z.string(),
  effective_price: z.number(),
  effective_replay_price: z.number(),
  game_id: z.string(),
  has_override: z.union([z.number(), z.boolean()]),
  override_price: z.number().nullable(),
  override_replay_price: z.number().nullable(),
});

export const DevicePricesResponseSchema = z.object({
  device_id: z.string(),
  pricing: z.array(UpstreamPriceSchema),
  status: z.string().optional(),
});

/**
 * Body for setting one game's price on one device.
 *
 * The upstream field names are `override_price` / `override_replay_price`, NOT
 * `price` / `replay_price`. Established by probing the live endpoint on 2026-10-12 with
 * no-op values (the numbers sent equalled the values already in place, so no player-facing
 * price could change):
 *
 *   POST .../games/{id}/price  {"price":102,"replay_price":51}                      → 500
 *   POST .../games/{id}/price  {"override_price":102,"override_replay_price":51}   → 200
 *   POST .../games/{id}/price  {}                                                    → 200
 *
 * The 500 is a generic HTML error page, so the field names were the only signal. Note the
 * earlier `{price, replay_price}` shape was a guess taken from the response echo, and it
 * was wrong — the same names appear in the *response* while the *request* wants the
 * override-prefixed ones.
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
});

export type SetDeviceGamePriceInput = z.infer<typeof SetDeviceGamePriceSchema>;

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
});

export type DeviceView = z.infer<typeof DeviceViewSchema>;
export type GamePriceView = z.infer<typeof GamePriceViewSchema>;
