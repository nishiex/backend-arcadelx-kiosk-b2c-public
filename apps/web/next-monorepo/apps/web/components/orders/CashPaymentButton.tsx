"use client"

import React from "react"
import { Banknote, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { requestCashPayment, type KioskOrder } from "@/lib/backend-api"

export default function CashPaymentButton({ order, disabled, onChanged }: {
  order: KioskOrder
  disabled?: boolean
  onChanged?: (order: KioskOrder) => void
}) {
  const [busy, setBusy] = React.useState(false)
  const request = async () => {
    setBusy(true)
    try {
      const updated = await requestCashPayment(order.id)
      onChanged?.(updated)
      toast.success("Cash payment request sent. The supplier must confirm receipt.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not request cash payment")
    } finally {
      setBusy(false)
    }
  }

  return <button type="button" onClick={() => void request()} disabled={disabled || busy} className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
    {busy ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Pay by cash
  </button>
}
