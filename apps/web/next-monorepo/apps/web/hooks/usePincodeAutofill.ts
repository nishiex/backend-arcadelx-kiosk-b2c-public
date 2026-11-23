import React from "react"
import { useQuery } from "@tanstack/react-query"
import { lookupPincode, type PincodeLocation } from "@/lib/backend-api"
import { canonicalStateName, normalizeCityName } from "@/lib/india-locations"

export type PincodeAutofillStatus = "idle" | "loading" | "found" | "not-found" | "error"

export type PincodeAutofill = {
  status: PincodeAutofillStatus
  /** Line shown under the postal-code field, or null when there is nothing to say. */
  message: string | null
  /** Resolved PIN data, when the lookup found a place. */
  location: PincodeLocation | null
  /** State name applied to the form, in the spelling the state select uses. */
  state: string | null
  /** City applied to the form. */
  city: string | null
}

const IDLE: PincodeAutofill = {
  status: "idle",
  message: null,
  location: null,
  state: null,
  city: null,
}

/**
 * Fills a form's state and city from a six-digit PIN code.
 *
 * The form always stays usable: an unknown PIN, an upstream outage or a state
 * name the dropdown does not know leaves both fields editable and explains why,
 * so a postal-code lookup can never block a registration. Successful lookups are
 * cached by React Query, which also aborts the request when the PIN changes.
 */
export function usePincodeAutofill(
  pincode: string | null | undefined,
  applyLocation: (location: { state: string; city: string }) => void,
): PincodeAutofill {
  // A field registered without default values starts as undefined, so the hook
  // cannot assume a string even though the form type says one.
  const value = (pincode ?? "").trim()
  const enabled = /^\d{6}$/.test(value)

  const query = useQuery({
    queryKey: ["pincode-lookup", value],
    queryFn: ({ signal }) => lookupPincode(value, signal),
    enabled,
    retry: false,
    staleTime: 24 * 60 * 60 * 1_000,
  })

  // The callback is re-created on every render by most callers; keep the latest
  // one without making it a query dependency.
  const apply = React.useRef(applyLocation)
  React.useEffect(() => {
    apply.current = applyLocation
  }, [applyLocation])

  const location = query.data ?? null
  const state = React.useMemo(
    () => (location ? canonicalStateName(location.state) : null),
    [location],
  )
  const city = React.useMemo(
    () => (location ? normalizeCityName(location.city) : null),
    [location],
  )

  React.useEffect(() => {
    if (!state || !city) return
    apply.current({ state, city })
  }, [state, city])

  if (!enabled) return IDLE

  if (query.isPending) {
    return { ...IDLE, status: "loading", message: "Looking up the PIN code…" }
  }
  if (query.isError) {
    return {
      ...IDLE,
      status: "error",
      message: `Couldn't verify PIN ${value}. Choose the state and city manually.`,
    }
  }
  if (!location) {
    return {
      ...IDLE,
      status: "not-found",
      message: `No location found for PIN ${value}. Choose the state and city manually.`,
    }
  }
  if (!state) {
    return {
      ...IDLE,
      status: "not-found",
      location,
      message: `PIN ${value} belongs to "${location.state}", which is not in the state list. Choose the state manually.`,
    }
  }
  return {
    status: "found",
    message: `State and city set from PIN ${value}.`,
    location,
    state,
    city,
  }
}
