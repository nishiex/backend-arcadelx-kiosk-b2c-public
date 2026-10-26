import { beginMutationToast } from "./mutation-toast"

// Refresh tokens are rotated on every refresh. One shared lock prevents
// concurrent dashboard requests from trying to consume the same token.
let refreshing: Promise<boolean> | null = null
let signingOut = false
const API_REQUEST_TIMEOUT_MS = 20_000

function refreshSession(): Promise<boolean> {
  if (signingOut) return Promise.resolve(false)
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "include", signal: AbortSignal.timeout(15000) })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

export function setSigningOut(value: boolean) {
  signingOut = value
}

export function waitForSessionRefresh(): Promise<boolean> {
  return refreshing ?? Promise.resolve(true)
}

export async function sessionApiFetch(input: string, init?: RequestInit): Promise<Response> {
  const opts: RequestInit = { credentials: "include", ...init }
  // Every dashboard request must have a client-side deadline. Without this, a
  // stalled upstream request leaves React Query mutations pending indefinitely,
  // which makes action buttons look like the whole screen has frozen.
  if (!opts.signal) opts.signal = AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)
  const mutationToast = beginMutationToast(opts)
  try {
    const response = await fetch(input, opts)
    if (response.status !== 401 || /\/api\/auth\/(login|refresh|logout)/.test(input)) return response
    return (await refreshSession()) ? fetch(input, opts) : response
  } finally {
    mutationToast?.finish()
  }
}
