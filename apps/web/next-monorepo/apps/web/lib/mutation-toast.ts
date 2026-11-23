import { toast } from "sonner"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * How long a request may run before it is worth a toast.
 *
 * Every mutation used to raise "Saving changes…" the instant it started, so filter
 * changes, status polls and quick saves all announced a save that had already finished
 * ("showing saving changes everytime we do something in master admin kiosk tab"). Holding
 * the toast back means it only appears when the request is actually slow enough that the
 * user needs to know something is happening.
 */
const TOAST_DELAY_MS = 400

/**
 * Show feedback for a state-changing request.
 *
 * `message` lets auth flows say what they are doing: signing in is not saving data, and
 * the login screen was reporting "Saving data" while authenticating.
 */
export function beginMutationToast(init?: RequestInit, message = "Saving changes…") {
  const method = (init?.method ?? "GET").toUpperCase()
  if (!MUTATING_METHODS.has(method)) return null

  let id: ReturnType<typeof toast.loading> | undefined
  const timer = setTimeout(() => {
    id = toast.loading(message)
  }, TOAST_DELAY_MS)

  return {
    finish: () => {
      clearTimeout(timer)
      if (id !== undefined) toast.dismiss(id)
    },
  }
}
