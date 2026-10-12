import { ApiError } from '../../utils/ApiError';
import {
  DeviceListResponseSchema,
  DevicePricesResponseSchema,
  type DeviceView,
  type GamePriceView,
  type SetDeviceGamePriceInput,
} from '@shared-types/validationSchemas/Devices/device.validation';

/**
 * Client for Mothership's device fleet and per-device game pricing.
 *
 * This API stores no pricing of its own — pricing lives entirely in Mothership — so this
 * module only proxies. Reads are safe; `setDeviceGamePrice` mutates a live kiosk's price
 * and its route is therefore gated to the Company's OWNER/ADMIN.
 *
 * All three endpoints were confirmed live on 2026-10-12 with **read-only** requests:
 *   - `GET  /api/v1/kiosks/device-ids`                          → 9 devices
 *   - `GET  /api/v1/devices/{device_id}/prices`                  → 30 rows
 *   - `POST /api/v1/devices/{device_id}/games/{game_id}/price`   → contract inferred
 *
 * The write contract is now VERIFIED for field names: `override_price` /
 * `override_replay_price` are accepted (the response's own `price` / `replay_price` keys are
 * NOT — they provoke a 500). Not yet verified: whether a value differing from the base price
 * persists as an override. Testing that requires writing a genuinely different price to live
 * hardware, which has not been done.
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

export async function getDevicePrices(deviceId: string): Promise<GamePriceView[]> {
  const payload = await callMothership(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/prices`,
    { method: 'GET' },
  );
  const parsed = DevicePricesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership device API returned an unexpected pricing payload');
  }
  return mergeGamePrices(parsed.data.pricing);
}

/**
 * Set one game's price on one device.
 *
 * This writes to a live kiosk. The route above it requires Company OWNER/ADMIN, and the
 * caller is expected to have confirmed the change; nothing here is retried automatically,
 * because a retried price write is a second real change to a customer's machine.
 *
 * The upstream body keys are `override_price` / `override_replay_price`. Sending
 * `price` / `replay_price` — the names the *response* uses — makes Mothership answer 500.
 * That was confirmed against the live endpoint with no-op values, never a real price
 * change. `override_replay_price` is omitted rather than sent as null when the operator
 * did not supply one, so an unspecified replay price cannot be read as "set it to zero".
 */
export async function setDeviceGamePrice(
  deviceId: string,
  gameId: string,
  input: SetDeviceGamePriceInput,
): Promise<unknown> {
  return callMothership(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/games/${encodeURIComponent(gameId)}/price`,
    {
      method: 'POST',
      body:
        input.replay_price === undefined
          ? { override_price: input.price }
          : { override_price: input.price, override_replay_price: input.replay_price },
    },
  );
}
