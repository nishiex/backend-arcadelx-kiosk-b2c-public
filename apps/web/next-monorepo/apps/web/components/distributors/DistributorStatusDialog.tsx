"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { setDistributorStatus, type Distributor } from "@/lib/backend-api"

export default function DistributorStatusDialog({ distributor }: { distributor: Distributor }) {
  const [open, setOpen] = React.useState(false)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => setDistributorStatus(distributor.id, !distributor.isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["distributors"] })
      setOpen(false)
    },
  })
  const action = distributor.isActive ? "Deactivate" : "Activate"
  return (
    <Dialog.Root open={open} onOpenChange={value => { if (!mutation.isPending) { mutation.reset(); setOpen(value) } }}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={!distributor.statusManagementAvailable} aria-label={`${action} ${distributor.name}`} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">{action}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">{action} Distributor</Dialog.Title>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close status change" className="absolute right-4 top-4 rounded-md p-2 hover:bg-muted disabled:opacity-50"><X size={18} /></Dialog.Close>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            {distributor.isActive
              ? `All users in ${distributor.name} will lose account access and cannot log in until the Company reactivates it.`
              : `Users in ${distributor.name} can log in again with their existing credentials. They will need to sign in again.`}
          </Dialog.Description>
          {mutation.isError && <p role="alert" className="mt-4 text-sm text-destructive">{mutation.error.message}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close disabled={mutation.isPending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</Dialog.Close>
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{mutation.isPending ? "Updating…" : action}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
