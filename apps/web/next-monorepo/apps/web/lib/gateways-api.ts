/**
 * API client for payment-gateway administration.
 *
 * Kept in its own module rather than added to `backend-api.ts`: that file is a single
 * large module and this surface is optional and admin-only, so the separation keeps
 * both easier to review.
 *
 * The request helper mirrors `backend-api.ts` (same-origin relative paths, cookie
 * credentials, one single-flight refresh on 401) because that helper is not exported
 * from there.
 */

export type Gateway = {
  provider: string
  display_name: string
  priority: number
  is_active: boolean
  has_driver: boolean
  credentials: Record<string, unknown>
  updated_at?: string
}

export type GatewaysResult = {
  total: number
  gateways: Gateway[]
}

export type UpsertGatewayInput = {
  provider: string
  display_name?: string
  is_active?: boolean
  priority?: number
  credentials?: Record<string, unknown>
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return sessionApiFetch(input, init)
}

/**
 * Reads the envelope `{ statusCode, data, message, success }` this API returns.
 * On failure it raises the server's message, and when the server attached an
 * `upstreamBody` (our gateway routes forward the upstream reason) it appends that,
 * because the message alone does not say why Mothership refused.
 */
async function handleRes<T>(res: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // fall through to the generic error below
  }
  const envelope = body as
    | { data?: T; message?: string; errors?: unknown }
    | null

  if (!res.ok) {
    const base =
      envelope?.message ||
      (res.status === 401
        ? "Your session has expired. Please log in again."
        : `Request failed (HTTP ${res.status})`)
    const upstream = (envelope?.errors as { upstreamBody?: string } | null)
      ?.upstreamBody
    throw new Error(
      upstream ? `${base} — upstream said: ${upstream}` : base
    )
  }
  return envelope?.data as T
}

export async function fetchGateways(): Promise<GatewaysResult> {
  const res = await apiFetch("/api/admin/gateways")
  return handleRes<GatewaysResult>(res)
}

export async function saveGateway(
  input: UpsertGatewayInput
): Promise<unknown> {
  const res = await apiFetch("/api/admin/gateways", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return handleRes<unknown>(res)
}

export async function toggleGateway(
  provider: string,
  isActive: boolean,
  totpCode?: string,
): Promise<unknown> {
  const res = await apiFetch("/api/admin/gateways/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      is_active: isActive,
      ...(totpCode ? { totpCode } : {}),
    }),
  })
  return handleRes<unknown>(res)
}

export async function reorderGateways(
  gateways: { provider: string; priority: number }[]
): Promise<unknown> {
  const res = await apiFetch("/api/admin/gateways/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gateways }),
  })
  return handleRes<unknown>(res)
}

export async function deleteGateway(provider: string, totpCode: string): Promise<unknown> {
  const res = await apiFetch("/api/admin/gateways", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, totpCode }),
  })
  return handleRes<unknown>(res)
}
import { sessionApiFetch } from "./session-api"

