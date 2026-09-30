"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { decideRequest } from "@/lib/backend-api"

export default function DecisionDialog({ kind, id, subject, action, disabled = false }: {
  kind: "network" | "agreements" | "orders"; id: string; subject: string
  action: "approve" | "reject"; disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const qc = useQueryClient()
  const label = action === "reject" ? "Reject" : kind === "network" ? "Accept" : "Approve"
  const mutation = useMutation({
    mutationFn: () => decideRequest(kind, id, action),
    onSuccess: () => setOpen(false),
    onSettled: async () => {
      await Promise.all(["review-requests", "networkRequests", "orders", "kiosks", "inventorySummary"].map(key => qc.invalidateQueries({ queryKey: [key] })))
    },
  })
  const description = action === "reject"
    ? kind === "orders" ? "The unapproved request will be rejected. No stock will move, and the order will remain in history." : "This request will be rejected and kept in your history. This decision cannot be undone here."
    : kind === "network" ? "This connects your organizations. Financial agreements require a separate approval."
      : kind === "agreements" ? "The displayed agreement terms will become active for both organizations."
        : "Available kiosks will be reserved for this order and its invoice will be prepared. Approval does not record payment or delivery."
  return (
    <Dialog.Root open={open} onOpenChange={value => { if (!mutation.isPending) { mutation.reset(); setOpen(value) } }}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={disabled} aria-label={`${label} ${subject}`} className={`rounded-lg border px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${action === "reject" ? "border-border hover:bg-muted" : "border-primary bg-primary text-primary-foreground hover:opacity-90"}`}>{label}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">{label} request?</Dialog.Title>
          <p className="mt-2 break-words text-sm font-medium">{subject}</p>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">{description}</Dialog.Description>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close decision" className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"><X size={18} /></Dialog.Close>
          {mutation.isError && <p role="alert" className="mt-4 text-sm text-destructive">{mutation.error.message}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close disabled={mutation.isPending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</Dialog.Close>
            <button type="button" disabled={mutation.isPending || disabled} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{mutation.isPending ? "Saving…" : label}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
