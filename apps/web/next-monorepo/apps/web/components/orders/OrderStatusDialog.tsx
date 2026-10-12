"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import {
  dispatchOrder,
  markOrderAsPaid,
  type KioskOrder,
} from "@/lib/backend-api"
import { deliverOrderWithLocation } from "@/lib/order-delivery"

type Step = {
  /** The API call for this step. */
  run: (orderId: string) => Promise<KioskOrder>
  button: string
  title: string
  description: string
  /** Consequence shown in the confirmation, or null when there is none to explain. */
  confirm: string | null
  /**
   * When set, the confirmation asks for a required text value before running. Delivery
   * uses this: the location is written onto every kiosk during the ownership transfer,
   * so the API rejects a missing value and the kiosks must not move without it.
   */
  requireLocation?: boolean
}

/**
 * The supplier-side progression after approval. The API enforces the same order and
 * rejects a step whose prerequisite is missing, so each entry states its condition.
 * Payment verification is a recorded decision, not a payment gateway call.
 */
const RECORD_PAYMENT: Step = {
  run: markOrderAsPaid,
  button: "Mark as paid",
  title: "Record payment?",
  description: "Confirms the supplier has received payment for this order so it becomes ready for dispatch.",
  confirm: "Only confirm once payment has actually been received: this records it as settled. No payment is taken by this action.",
}

const DISPATCH: Step = {
  run: dispatchOrder,
  button: "Dispatch",
  title: "Dispatch this order?",
  description: "Moves the reserved machines to dispatched, ready for delivery.",
  confirm: "The reserved machines become assigned and stay with the supplier until delivery. Delivery is a separate step.",
}

const DELIVER: Step = {
  // A required location is collected in the confirmation, so this step cannot run from
  // the plain mutation callback: the dialog passes the entered value through.
  run: (orderId: string) => deliverOrderWithLocation(orderId, ""),
  button: "Mark delivered",
  title: "Mark as delivered?",
  description: "Transfers ownership of the dispatched machines to the receiving organization.",
  confirm: "This transfers the machines to the other organization and clears their reservation. It cannot be undone here.",
  requireLocation: true,
}

/**
 * The next lifecycle step for an order, or null when it is not the supplier's to
 * advance (the API requires the caller to be the parent organization, and REQUEST
 * orders are approving-side only while ALLOCATION orders are pushed by the parent).
 *
 * Steps are gated on the row's own persisted state, which the API also re-checks, so
 * a stale list can never fire an out-of-order transition.
 */
export function nextStep(order: KioskOrder): Step | null {
  if (order.status === "APPROVED") {
    return order.paymentStatus === "PAID" ? DISPATCH : RECORD_PAYMENT
  }
  if (order.status === "DISPATCHED") return DELIVER
  return null
}

export default function OrderStatusDialog({
  order,
  disabled,
  onChanged,
}: {
  order: KioskOrder
  /** True while order actions are reported unavailable by the API. */
  disabled: boolean
  onChanged?: (order: KioskOrder) => void
}) {
  const step = nextStep(order)
  // Only forward lifecycle steps are offered. Rejection was removed from this dialog:
  // an unpaid request under review now simply shows no action, so nothing can be
  // declined from the Orders page.
  const actions: Step[] = step ? [step] : []
  const [selected, setSelected] = React.useState<Step | null>(null)
  const [open, setOpen] = React.useState(false)
  // Delivery-only: the site the kiosks are installed at. Required by the API.
  const [location, setLocation] = React.useState("")
  const queryClient = useQueryClient()
  const mutation = useMutation({
    // When a location is required it is sent with the call; otherwise the step's own
    // run() is used unchanged so no other lifecycle step is affected.
    mutationFn: () =>
      selected!.requireLocation
        ? deliverOrderWithLocation(order.id, location.trim())
        : selected!.run(order.id),
    onSuccess: async updated => {
      onChanged?.(updated)
      setOpen(false)
      setSelected(null)
      setLocation("")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["kiosks"] }),
        queryClient.invalidateQueries({ queryKey: ["inventorySummary"] }),
        queryClient.invalidateQueries({ queryKey: ["revenue-series"] }),
      ])
    },
  })

  if (!actions.length) return null
  const active = selected ?? actions[0]!

  return (
    <Dialog.Root
      open={open}
      onOpenChange={value => {
        if (mutation.isPending) return
        mutation.reset()
        // Only clear on close. Radix fires onOpenChange after the trigger's own
        // onClick, so clearing here while opening would discard the selection and
        // the confirm button would have no action to run.
        if (!value) {
          setSelected(null)
          setLocation("")
        }
        setOpen(value)
      }}
    >
      {actions.map(action => (
        <Dialog.Trigger key={action.button} asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${action.button} ${order.orderNumber}`}
            onClick={() => setSelected(action)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.button}
          </button>
        </Dialog.Trigger>
      ))}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">{active.title}</Dialog.Title>
          <p className="mt-2 font-mono text-sm font-medium">{order.orderNumber}</p>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">{active.description}</Dialog.Description>
          {active.confirm && (
            <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">{active.confirm}</p>
          )}
          {active.requireLocation && (
            <div className="mt-4">
              <label htmlFor={`delivery-location-${order.id}`} className="mb-1.5 block text-sm font-medium">
                Delivery location <span className="text-destructive">*</span>
              </label>
              <input
                id={`delivery-location-${order.id}`}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                placeholder="e.g. Phoenix Mall, Pune"
                required
                minLength={3}
                maxLength={200}
                disabled={mutation.isPending}
                value={location}
                onChange={event => setLocation(event.target.value)}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Recorded on each kiosk as its installed site. The machines are not
                transferred until this is saved.
              </p>
            </div>
          )}
          <Dialog.Close
            disabled={mutation.isPending}
            aria-label="Close order action"
            className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted disabled:opacity-50"
          >
            <X size={18} />
          </Dialog.Close>
          {mutation.isError && (
            <p role="alert" className="mt-4 text-sm text-destructive">{mutation.error.message}</p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close disabled={mutation.isPending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              disabled={mutation.isPending || disabled || (active.requireLocation === true && location.trim().length < 3)}
              onClick={() => mutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              {mutation.isPending ? "Saving…" : active.button}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
