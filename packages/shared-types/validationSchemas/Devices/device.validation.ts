import { z } from "zod";

/**
 * Device fleet and per-device game pricing, as served by Mothership.
 *
 * Shapes below were established by reading the live host on 2026-10-12 with
 * **read-only** requests:
 *   - `GET  /api/v1/kiosks/device-ids`                       → 9 devices
 *   - `GET  /api/v1/devices/{device_id}/prices`               → 30 rows (15 games × 2)
 *
 * Pricing is read per device but WRITTEN per game: see `SetDeviceGamePriceSchema` below for
 * which upstream endpoint actually persists a change.
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
 * Body for setting one game's price.
 *
 * These are OUR field names. The API forwards them to Mothership's CATALOG endpoint
 * (`POST /api/v1/games/{game_id}/metadata`) as `price` / `replay_price`, which is the
 * write path that actually persists — confirmed live on 2026-10-13 (Empire Saviour
 * 100 → 101 → 100, observed on adlx-2026-a005's own pricing read).
 *
 * Why not the per-device endpoint `POST /api/v1/devices/{id}/games/{id}/price`: it answers
 * 200 `{"status":"success"}` and changes nothing, echoing the unchanged price while
 * `has_override` stays 0. Probed on 2026-10-13 with every body shape that returns 200;
 * adding `price` to that body returns 500 instead. See `devices.service.ts` for the detail.
 *
 * Consequence for callers: a catalog price is per GAME, so a change applies to that game on
 * every kiosk, not only the device whose id appears in our route.
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

/**
 * Result of a price write, as reported only AFTER Mothership confirms it.
 *
 * The values here are re-read from Mothership, not echoed from the request: the price
 * endpoint used to answer 200 while doing nothing, so an unverified echo is not evidence.
 */
export const SetDeviceGamePriceResultSchema = z.object({
  deviceId: z.string(),
  gameId: z.string(),
  displayName: z.string(),
  /** Price Mothership reports after the write, i.e. the confirmed value. */
  price: z.number(),
  replayPrice: z.number().nullable(),
  /** Mothership keeps one price per game, so the write covers every kiosk. */
  scope: z.literal('GAME_CATALOG'),
});

export type SetDeviceGamePriceResult = z.infer<typeof SetDeviceGamePriceResultSchema>;

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
