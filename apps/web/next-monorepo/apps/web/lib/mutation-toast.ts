import { toast } from "sonner"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Show immediate feedback while a state-changing request is in flight. */
export function beginMutationToast(init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase()
  if (!MUTATING_METHODS.has(method)) return null

  const id = toast.loading("Saving changes…")
  return { finish: () => toast.dismiss(id) }
}
