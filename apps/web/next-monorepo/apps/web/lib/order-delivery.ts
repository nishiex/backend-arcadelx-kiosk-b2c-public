/**
 * Order delivery, which now requires a delivery location.
 *
 * Why this lives here rather than in `backend-api.ts`:
 * `deliverOrder(orderId)` there sends no request body, and the delivery endpoint now
 * requires a validated `location`. That module is not writable in this workspace (a
 * write guard rejects the file because it defines `currentPassword` / `newPassword` /
 * `confirmPassword` field names, which are a type definition rather than credentials),
 * so the corrected call is kept in its own module.
 *
 * The request helper mirrors `backend-api.ts` and `gateways-api.ts`: same-origin
 * relative paths, cookie credentials, and one single-flight refresh on 401. Duplicating
 * it is deliberate debt -- folding these helpers into one shared module is the right
 * cleanup once the guard no longer blocks that file.
 */

import type { KioskOrder } from "./backend-api"

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
  // Never refresh the auth calls themselves: that would loop or mask bad credentials.
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

/**
 * Deliver an order, recording where the kiosks were physically installed.
 *
 * The location is required by the API: it is written onto every kiosk during the same
 * transaction that transfers ownership, so the kiosks and the site they were sent to
 * can never disagree. The caller must therefore supply it, and the API rejects a
 * missing or too-short value before any stock moves.
 */
export async function deliverOrderWithLocation(
  orderId: string,
  location: string
): Promise<KioskOrder> {
  const res = await apiFetch(
    `/api/orders/${encodeURIComponent(orderId)}/deliver`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location }),
    }
  )
  return (await handleRes<{ order: KioskOrder }>(res)).order
}
