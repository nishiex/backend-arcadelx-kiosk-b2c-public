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
    throw new Error(message)
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

/**
 * Set one game's price on one device.
 *
 * This writes to live hardware, so the caller must confirm first. `replay_price` is only
 * sent when supplied, so an untouched replay price cannot be read as "set it to zero".
 */
export async function setDeviceGamePrice(
  deviceId: string,
  gameId: string,
  price: number,
  replayPrice?: number
): Promise<void> {
  const res = await apiFetch(
    `/api/devices/${encodeURIComponent(deviceId)}/games/${encodeURIComponent(gameId)}/price`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        replayPrice === undefined ? { price } : { price, replay_price: replayPrice }
      ),
    }
  )
  await handleRes<unknown>(res)
}
