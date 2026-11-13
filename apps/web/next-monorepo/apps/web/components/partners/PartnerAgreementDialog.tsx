"use client"

import React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { FullScreenDialog } from "@/components/common/FullScreenDialog"
import {
  createAgreement,
  fetchAgreementsForChild,
  terminateAgreement,
  updateAgreement,
  type Agreement,
} from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

const buttonClass = "rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"

function openAgreement(rows: Agreement[]) {
  return rows.find(row => row.status === "PENDING_APPROVAL" || row.status === "ACTIVE")
}

type PartnerAgreementTarget = {
  id: string
  name: string
  owner: { id: string; name: string; email: string } | null
}

export default function PartnerAgreementDialog({ partner, organizationId }: { partner: PartnerAgreementTarget; organizationId: string }) {
  const { isCompany, role } = useMe()
  const canEditAgreement = role === "OWNER"
  const canUpdateAgreement = canEditAgreement && isCompany
  const [open, setOpen] = React.useState(false)
  const [parentShare, setParentShare] = React.useState("60")
  const [childShare, setChildShare] = React.useState("40")
  const [deposit, setDeposit] = React.useState("0")
  const [nonRefundable, setNonRefundable] = React.useState("0")
  const [editing, setEditing] = React.useState(false)
  const queryClient = useQueryClient()
  const agreements = useQuery({
    queryKey: ["partner-agreements", organizationId, partner.id],
    queryFn: ({ signal }) => fetchAgreementsForChild(partner.id, signal),
    enabled: open,
  })
  const current = openAgreement(agreements.data ?? [])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["partner-agreements"] }),
      queryClient.invalidateQueries({ queryKey: ["partners"] }),
      queryClient.invalidateQueries({ queryKey: ["review-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["agreements"] }),
    ])
  }
  const draft = useMutation({
    mutationFn: () => {
      const terms = {
        parentSharePct: Number(parentShare), childSharePct: Number(childShare),
        depositAmountPerMachine: Number(deposit), nonRefundableAmountPerMachine: Number(nonRefundable),
      }
      if (parentShare === "" || childShare === "" || deposit === "" || nonRefundable === "" || Number(parentShare) + Number(childShare) !== 100) {
        throw new Error("Enter valid agreement shares totaling 100 and non-negative kiosk amounts.")
      }
      return createAgreement({ childOrgId: partner.id, ...terms })
    },
    onSuccess: async agreement => {
      toast.success(agreement.status === "ACTIVE" ? "Partner agreement saved and activated" : "Partner agreement saved")
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () => updateAgreement(current!.id, {
      parentSharePct: Number(parentShare),
      childSharePct: Number(childShare),
      depositAmountPerMachine: Number(deposit),
      nonRefundableAmountPerMachine: Number(nonRefundable),
    }),
    onSuccess: async () => {
      toast.success("Partner agreement updated and activated")
      setEditing(false)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const terminate = useMutation({
    mutationFn: () => terminateAgreement(current!.id),
    onSuccess: async () => {
      toast.success("Partner agreement terminated")
      setEditing(false)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const busy = draft.isPending || update.isPending || terminate.isPending

  React.useEffect(() => {
    if (!open || !current) return
    setParentShare(String(current.parentSharePct))
    setChildShare(String(current.childSharePct))
    setDeposit(String(current.depositAmountPerMachine))
    setNonRefundable(String(current.nonRefundableAmountPerMachine))
  }, [open, current?.id])

  const submitUpdate = () => {
    const parent = Number(parentShare)
    const child = Number(childShare)
    const depositAmount = Number(deposit)
    const nonRefundableAmount = Number(nonRefundable)
    if ([parent, child].some(value => !Number.isFinite(value) || value < 0 || value > 100) || parent + child !== 100) {
      toast.error("Enter valid agreement shares totaling 100")
      return
    }
    if ([depositAmount, nonRefundableAmount].some(value => !Number.isInteger(value) || value < 0)) {
      toast.error("Enter valid non-negative per-kiosk amounts")
      return
    }
    update.mutate()
  }

  return (
    <FullScreenDialog
      open={open}
      onOpenChange={value => { if (!busy) setOpen(value) }}
      trigger={
        <button type="button" className={buttonClass} aria-label={`Agreement for ${partner.name}`}>Agreement</button>
      }
      title={`Partner agreement · ${partner.name}`}
      description={isCompany ? "Define the Company-to-Partner terms and save the agreement." : "Define your Distributor-to-Partner terms and save the agreement."}
    >          <div className="mt-5 space-y-4">
            {agreements.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">Loading agreement details…</p>
            ) : agreements.isError ? (
              <p role="alert" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-destructive">Couldn&apos;t load this Partner&apos;s agreement details.</p>
            ) : current?.status === "PENDING_APPROVAL" ? (
              <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Waiting for {partner.name}&apos;s Owner to approve this agreement.</p>
            ) : current?.status === "ACTIVE" ? (
              <div className="space-y-3">
                <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">This Partner agreement is active.</p>
                {canEditAgreement && !editing && (
                  <div className="flex flex-wrap gap-2">
                    {canUpdateAgreement && <button type="button" disabled={busy} onClick={() => setEditing(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                      Update agreement terms
                    </button>}
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Terminate the agreement with ${partner.name}?`)) terminate.mutate() }} className="rounded-lg border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      {terminate.isPending ? "Terminating…" : "Terminate agreement"}
                    </button>
                  </div>
                )}
                {!isCompany && canEditAgreement && !editing && (
                  <p className="text-sm text-muted-foreground">Terminate the current agreement before saving new Distributor-to-Partner terms.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{isCompany ? "The Partner Owner must approve before kiosks can be sent." : "These Distributor-to-Partner terms take effect immediately for this Partner."}</p>
                <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">Company share (%)<input type="number" min="0" max="100" step="0.01" value={parentShare} onChange={event => setParentShare(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Partner share (%)<input type="number" min="0" max="100" step="0.01" value={childShare} onChange={event => setChildShare(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Collection per kiosk (INR)<input type="number" min="0" step="1" value={deposit} onChange={event => setDeposit(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Non-refundable fee (INR)<input type="number" min="0" step="1" value={nonRefundable} onChange={event => setNonRefundable(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                </div>
                <button type="button" disabled={busy} onClick={() => draft.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {draft.isPending && <Loader2 size={16} className="animate-spin" />}
                  {draft.isPending ? "Saving…" : "Save agreement"}
                </button>
              </div>
            )}
            {editing && current?.status === "ACTIVE" && canUpdateAgreement && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">Updated terms take effect immediately for future Partner orders.</p>
                <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">{isCompany ? "Company" : "Distributor"} share (%)<input type="number" min="0" max="100" step="0.01" value={parentShare} onChange={event => setParentShare(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Partner share (%)<input type="number" min="0" max="100" step="0.01" value={childShare} onChange={event => setChildShare(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Collection per kiosk (INR)<input type="number" min="0" step="1" value={deposit} onChange={event => setDeposit(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-medium">Non-refundable fee (INR)<input type="number" min="0" step="1" value={nonRefundable} onChange={event => setNonRefundable(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></label>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={submitUpdate} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{update.isPending ? "Updating…" : "Save updated terms"}</button>
                  <button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Cancel</button>
                </div>
              </div>
            )}
          </div>
    </FullScreenDialog>
  )
}
