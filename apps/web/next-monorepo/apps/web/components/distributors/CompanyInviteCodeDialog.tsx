"use client"

import React from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Copy, KeyRound, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { generateCompanyInviteCode, generateCompanyMemberInvite, type CompanyInviteCode, type ManageableRole } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

export const companyInviteCodeKey = (organizationId: string | undefined) =>
  ["company-invite-code", organizationId] as const

export default function CompanyInviteCodeDialog({
  onUseCode,
  disabled = false,
  purpose = "distributor",
}: {
  onUseCode?: (code: string) => void
  disabled?: boolean
  purpose?: "distributor" | "members"
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedRole, setSelectedRole] = React.useState<ManageableRole>("STAFF")
  const queryClient = useQueryClient()
  const { me, canManageDistributors, canManageMembers, role, isError, can } = useMe()
  const members = purpose === "members"
  const baseKey = companyInviteCodeKey(me?.membership?.organizationId)
  const queryKey = members ? [...baseKey, "members"] : baseKey
  const allowedRoles: ManageableRole[] = role === "OWNER" ? ["ADMIN", "MANAGER", "STAFF"] : ["MANAGER", "STAFF"]
  const inviteRole = allowedRoles.includes(selectedRole) ? selectedRole : "STAFF"
  const mutation = useMutation({
    mutationFn: () => members ? generateCompanyMemberInvite(inviteRole) : generateCompanyInviteCode(),
    onSuccess: (code) => {
      queryClient.removeQueries({ queryKey: baseKey })
      queryClient.setQueryData(queryKey, code)
    },
  })
  const invite = mutation.data ?? queryClient.getQueryData<CompanyInviteCode>(queryKey)

  if (members ? (isError || me?.membership?.status !== "ACTIVE" || !canManageMembers) : (!canManageDistributors || !can("DISTRIBUTORS", "CREATE"))) return null

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
          <Dialog.Title className="pr-7 text-lg font-semibold">{members ? "Company member invite code" : "Distributor invite code"}</Dialog.Title>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close invite code" className="absolute right-4 top-4 rounded-md p-2 hover:bg-muted disabled:opacity-50"><X size={18} /></Dialog.Close>
          <Dialog.Description className="mt-3 text-sm text-muted-foreground">
            {members ? "Invite one colleague to your Company with the selected role. The code grants dashboard access after registration and expires after seven days or its first use. Generating a new code replaces the current Company invite code." : "Generate a Company code to register one Distributor. It expires after seven days. Generating a new code replaces the current Company invite code."}
          </Dialog.Description>
          {members && <div className="mt-4">
            <label htmlFor="member-invite-role" className="mb-1.5 block text-sm font-medium">Member role</label>
            <select id="member-invite-role" value={inviteRole} disabled={mutation.isPending} onChange={event => setSelectedRole(event.target.value as ManageableRole)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm">
              {allowedRoles.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>}
          {invite && (
            <div className="mt-5 space-y-2">
              <label htmlFor="generated-company-invite" className="block text-sm font-medium">Company invite code</label>
              <div className="flex gap-2">
                <input id="generated-company-invite" readOnly value={invite.inviteCode} onFocus={event => event.target.select()} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-lg tracking-widest" />
                <button type="button" onClick={copyCode} disabled={mutation.isPending} aria-label="Copy invite code" className="rounded-lg border border-border px-3 hover:bg-muted disabled:opacity-50"><Copy size={18} /></button>
              </div>
              <p className="text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleString()}</p>
              {members && <p className="text-sm text-muted-foreground">Share this code and the <Link href="/join" className="underline">registration page</Link> with your colleague. Role: {invite.role}.</p>}
            </div>
          )}
          {mutation.isError && <p role="alert" className="mt-4 text-sm text-destructive">{mutation.error.message}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              {mutation.isPending ? "Generating…" : invite ? "Generate new code" : "Generate code"}
            </button>
            {invite && !members && !mutation.isPending && (onUseCode ? (
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
