"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, X } from "lucide-react"
import { createOrder, type CreatedOrder, type OrgType } from "@/lib/backend-api"
import { KIOSK_MODELS } from "@/lib/kiosk-models"

export default function CreateOrderDialog({ organizationId, orgType, disabled, onCreated }: {
  organizationId: string
  orgType: OrgType
  disabled: boolean
  onCreated: (order: CreatedOrder) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [quantity, setQuantity] = React.useState("1")
  const [modelDraft, setModelDraft] = React.useState("")
  const submitting = React.useRef(false)
  const qc = useQueryClient()
  
  const validQuantity = quantity.trim() !== "" && Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 50
  
  const mutation = useMutation({
    mutationFn: () => createOrder({ type: "REQUEST", quantity: Number(quantity) }),
    retry: false,
    onSuccess: order => { setOpen(false); onCreated(order) },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orders", organizationId] }),
        qc.invalidateQueries({ queryKey: ["workflow-readiness"] }),
      ])
    },
  })
  
  const blocked = disabled || !validQuantity || mutation.isPending
  const changeOpen = (value: boolean) => {
    if (submitting.current) return
    if (value) { setQuantity("1"); setModelDraft(""); mutation.reset() }
    setOpen(value)
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={disabled} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />Request Kiosks</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">Request kiosks </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Send a request to your supplier for approval. Your active agreement determines the order amounts.</Dialog.Description>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close container request" className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"><X size={18} /></Dialog.Close>
          <form className="mt-5 space-y-5" onSubmit={async event => {
            event.preventDefault()
            if (blocked || submitting.current) return
            submitting.current = true
            try { await mutation.mutateAsync() } catch { /* Error is displayed below. */ }
            finally { submitting.current = false }
          }}>
            {disabled && <p role="status" className="text-sm text-muted-foreground">Kiosk requests are temporarily unavailable. Please try again later.</p>}
            
            <label className="block space-y-2 text-sm font-medium">Number of containers
              <input aria-label="Number of containers" aria-invalid={!validQuantity} aria-describedby="request-quantity-hint" type="number" min={1} max={50} step={1} required value={quantity} disabled={mutation.isPending || disabled} onChange={event => setQuantity(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5" />
            </label>
            <p id="request-quantity-hint" className={`text-sm ${validQuantity ? "text-muted-foreground" : "text-destructive"}`}>Request between 1 and 50 containers.</p>
            <label className="block space-y-2 text-sm font-medium">Model type (draft)
              <select aria-label="Model type (draft)" aria-describedby="request-model-hint" value={modelDraft} disabled={mutation.isPending || disabled} onChange={event => setModelDraft(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5">
                <option value="">Select a kiosk model</option>
                {KIOSK_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <p id="request-model-hint" className="text-sm text-muted-foreground">For planning only. This model is not saved or sent to your Company. Only the container quantity is submitted.</p>
            {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
            <div className="flex justify-end gap-3">
              <Dialog.Close disabled={mutation.isPending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</Dialog.Close>
              <button type="submit" disabled={blocked} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{mutation.isPending ? "Submitting..." : "Submit request"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
