/**
 * Device fleet and per-device game pricing (`/api/devices`), proxied from Mothership by
 * our own API so the dashboard never talks to Mothership directly and our role checks
 * apply.
 *
 * Kept in its own module rather than `backend-api.ts`, following `gateways-api.ts`:
 * that file is not writable in this workspace (a write guard rejects it because it
 * defines `currentPassword` / `newPassword` / `confirmPassword` field names, which are
 * a type definition rather than credentials). The request helper mirrors the one there.
 */

let refreshing: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const opts: RequestInit = { credentials: "include", ...init }
  const res = await fetch(input, opts)
  if (res.status !== 401 || /\/api\/auth\/(login|refresh|logout)/.test(input)) {
    return res
  }
  const ok = await refreshSession()
  return ok ? fetch(input, opts) : res
}

function describeDevicePriceVerification(errors: unknown): string | null {
  if (typeof errors !== "object" || errors === null) return null
  const details = errors as {
    requested?: { price?: unknown; replayPrice?: unknown }
    observed?: {
      price?: unknown
      replayPrice?: unknown
      hasOverride?: unknown
      overridePrice?: unknown
      overrideReplayPrice?: unknown
      basePrice?: unknown
      baseReplayPrice?: unknown
      catalogPrice?: unknown
      catalogReplayPrice?: unknown
    } | null
    changedDevices?: unknown
    fleetChanged?: unknown
    targetVerified?: unknown
  }
  if (!details.requested || !("observed" in details)) return null

  const requested = `requested ${String(details.requested.price)} / replay ${String(details.requested.replayPrice)}`
  const observed = details.observed
    ? `device read back ${String(details.observed.price)} / replay ${String(details.observed.replayPrice)}, catalog=${String(details.observed.catalogPrice ?? details.observed.basePrice)} / replay ${String(details.observed.catalogReplayPrice ?? details.observed.baseReplayPrice)}, override=${String(details.observed.hasOverride)}`
    : "the requested game was missing from the selected device readback"
  const changedDevices = Array.isArray(details.changedDevices)
    ? details.changedDevices.map(String).join(", ") || "none"
    : "not available"
  const fleetState = details.fleetChanged === true ? "device list changed" : "device list unchanged"

  // A device write the upstream does not confirm should point the operator at the explicit
  // fleet-wide action while never taking it on their behalf.
  const nextStep =
    details.targetVerified === false
      ? ' To set this price on every kiosk instead, use "Apply to all kiosks".'
      : ""

  return `Price verification details: ${requested}; ${observed}; other devices changed: ${changedDevices}; ${fleetState}.${nextStep}`
}

async function handleRes<T>(res: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // fall through to the generic error below
  }
  const envelope = body as { data?: T; message?: string; errors?: unknown } | null
  if (!res.ok) {
    const message =
      envelope?.message ||
      (res.status === 401
        ? "Your session has expired. Please log in again."
        : `Request failed (HTTP ${res.status})`)
    const details = describeDevicePriceVerification(envelope?.errors)
    throw new Error(details ? `${message} ${details}` : message)
  }
  return envelope?.data as T
}

/** One device as the API returns it (normalised, camelCase). */
export type DeviceView = {
  deviceId: string
  hardwareUuid: string | null
  headscaleIp: string | null
  isOnline: boolean
  kioskNumber: number | null
  lastSeen: string | null
  location: string | null
  publicIp: string | null
}

/**
 * One game's price, with Mothership's duplicate rows already merged by the API.
 * `gameId` is the id that actually carries the price, so it is the id to write back.
 */
export type GamePriceView = {
  gameId: string
  displayName: string
  basePrice: number
  baseReplayPrice: number
  effectivePrice: number
  effectiveReplayPrice: number
  hasOverride: boolean
  overridePrice: number | null
  overrideReplayPrice: number | null
  /** Upstream rows collapsed into this one; 2 means Mothership returned a duplicate. */
  mergedRows: number
}

export async function fetchDevices(): Promise<{
  devices: DeviceView[]
  lastUpdated: string | null
  total: number
}> {
  const res = await apiFetch("/api/devices", { cache: "no-store" })
  return handleRes<{ devices: DeviceView[]; lastUpdated: string | null; total: number }>(res)
}

export async function fetchDevicePrices(
  deviceId: string
): Promise<{ deviceId: string; games: GamePriceView[] }> {
  const res = await apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/prices`, {
    cache: "no-store",
  })
  return handleRes<{ deviceId: string; games: GamePriceView[] }>(res)
}

export type ResetDevicePricesResult = {
  deviceId: string
  gamesReset: number
  scope: "DEVICE_OVERRIDES"
}

export type SetDeviceGamePriceResult = {
  deviceId: string
  gameId: string
  displayName: string
  price: number
  replayPrice: number
  scope: "DEVICE_GAME_OVERRIDE" | "GAME_CATALOG"
}

/**
 * Set and verify one game's price in the requested scope.
 *
 * `DEVICE` (the default) writes a device-only override; `GAME_CATALOG` updates the game's
 * catalog price for every kiosk and is sent only when the operator explicitly chooses the
 * "Apply to all kiosks" action. The API never substitutes one scope for the other.
 */
export async function setDeviceGamePrice(
  deviceId: string,
  gameId: string,
  input: { price: number; replay_price: number; scope?: "DEVICE" | "GAME_CATALOG" }
): Promise<SetDeviceGamePriceResult> {
  const res = await apiFetch(
    `/api/devices/${encodeURIComponent(deviceId)}/games/${encodeURIComponent(gameId)}/price`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  )
  return handleRes<SetDeviceGamePriceResult>(res)
}

/** Reset only this device's overrides; the API confirms all prices returned to catalog values. */
export async function resetDevicePrices(deviceId: string): Promise<ResetDevicePricesResult> {
  const res = await apiFetch(
    `/api/devices/${encodeURIComponent(deviceId)}/prices/reset`,
    { method: "POST" }
  )
  return handleRes<ResetDevicePricesResult>(res)
}
