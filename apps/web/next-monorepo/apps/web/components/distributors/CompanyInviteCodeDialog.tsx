"use client"

import React from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Copy, KeyRound, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { generateCompanyInviteCode, type CompanyInviteCode } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

export const companyInviteCodeKey = (organizationId: string | undefined) =>
  ["company-invite-code", organizationId] as const

export default function CompanyInviteCodeDialog({
  onUseCode,
  disabled = false,
}: {
  onUseCode?: (code: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const queryClient = useQueryClient()
  const { me, canManageDistributors, can } = useMe()
  const queryKey = companyInviteCodeKey(me?.membership?.organizationId)
  const mutation = useMutation({
    mutationFn: generateCompanyInviteCode,
    onSuccess: (code) => queryClient.setQueryData(queryKey, code),
  })
  const invite = mutation.data ?? queryClient.getQueryData<CompanyInviteCode>(queryKey)

  if (!canManageDistributors || !can("DISTRIBUTORS", "CREATE")) return null

  async function copyCode() {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.inviteCode)
      toast.success("Invite code copied")
    } catch {
      toast.error("Couldn't copy the code. Select it and copy it manually.")
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={value => {
      if (!mutation.isPending) {
        mutation.reset()
        setOpen(value)
      }
    }}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={disabled} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
          <KeyRound size={16} /> Generate Invite Code
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">Distributor invite code</Dialog.Title>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close invite code" className="absolute right-4 top-4 rounded-md p-2 hover:bg-muted disabled:opacity-50"><X size={18} /></Dialog.Close>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            Generate a Company code to register one Distributor. It expires after seven days. Generating a new code replaces the current Company invite code.
          </Dialog.Description>
          {invite && (
            <div className="mt-5 space-y-2">
              <label htmlFor="generated-company-invite" className="block text-sm font-medium">Company invite code</label>
              <div className="flex gap-2">
                <input id="generated-company-invite" readOnly value={invite.inviteCode} onFocus={event => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-lg tracking-widest" />
                <button type="button" onClick={copyCode} disabled={mutation.isPending} aria-label="Copy invite code" className="rounded-lg border border-border px-3 hover:bg-muted disabled:opacity-50"><Copy size={18} /></button>
              </div>
              <p className="text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleString()}</p>
            </div>
          )}
          {mutation.isError && <p role="alert" className="mt-4 text-sm text-destructive">{mutation.error.message}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              {mutation.isPending ? "Generating…" : invite ? "Generate new code" : "Generate code"}
            </button>
            {invite && !mutation.isPending && (onUseCode ? (
              <button type="button" onClick={() => { onUseCode(invite.inviteCode); setOpen(false) }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Use code</button>
            ) : (
              <Link href="/distributors/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Register Distributor</Link>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
