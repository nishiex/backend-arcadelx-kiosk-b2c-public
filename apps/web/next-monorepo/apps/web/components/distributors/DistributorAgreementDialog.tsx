"use client"

import React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { FullScreenDialog } from "@/components/common/FullScreenDialog"
import { cn } from "@workspace/ui/lib/utils"
import {
  createAgreement,
  fetchAgreementsForChild,
  fetchKiosks,
  terminateAgreement,
  updateAgreement,
  type Agreement,
  type Distributor,
} from "@/lib/backend-api"
import { orderDate, orderMoney } from "@/components/orders/order-display"

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

const AGREEMENT_STATUS_LABELS: Record<Agreement["status"], string> = {
  PENDING_APPROVAL: "Awaiting approval",
  ACTIVE: "Active",
  TERMINATED: "Terminated",
  REJECTED: "Rejected",
}

const AGREEMENT_STATUS_STYLES: Record<Agreement["status"], string> = {
  PENDING_APPROVAL: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  TERMINATED: "bg-muted text-muted-foreground",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-300",
}

/** Prisma Decimal arrives as a string; Ints arrive as numbers. */
const toNumber = (value: number | string | null | undefined) =>
  typeof value === "number" ? value : Number(value ?? NaN)

/** The newest agreement still occupying the distributor's open slot, if any. */
function currentAgreement(agreements: Agreement[]) {
  return agreements.find(agreement => agreement.status === "PENDING_APPROVAL" || agreement.status === "ACTIVE")
}

function AgreementSummary({ agreement }: { agreement: Agreement }) {
  const parentShare = toNumber(agreement.parentSharePct)
  const childShare = toNumber(agreement.childSharePct)
  const deposit = toNumber(agreement.depositAmountPerMachine)
  const nonRefundable = toNumber(agreement.nonRefundableAmountPerMachine)
  return (
    <div className="space-y-3 rounded-lg bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Current agreement</p>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", AGREEMENT_STATUS_STYLES[agreement.status])}>
          {AGREEMENT_STATUS_LABELS[agreement.status]}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Supplier share</dt>
          <dd>{Number.isNaN(parentShare) ? "—" : `${parentShare}%`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Recipient share</dt>
          <dd>{Number.isNaN(childShare) ? "—" : `${childShare}%`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Deposit / kiosk</dt>
          <dd>{Number.isNaN(deposit) ? "—" : orderMoney(deposit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Non-refundable / kiosk</dt>
          <dd>{Number.isNaN(nonRefundable) ? "—" : orderMoney(nonRefundable)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">Drafted {orderDate(agreement.createdAt)}</p>
    </div>
  )
}

export default function DistributorAgreementDialog({
  distributor,
  organizationId,
}: {
  distributor: Distributor
  organizationId: string
}) {
  const [open, setOpen] = React.useState(false)
  const [parentSharePct, setParentSharePct] = React.useState("60")
  const [childSharePct, setChildSharePct] = React.useState("40")
  const [depositAmount, setDepositAmount] = React.useState("")
  const [nonRefundableAmount, setNonRefundableAmount] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const queryClient = useQueryClient()

  const agreements = useQuery({
    queryKey: ["child-agreements", organizationId, distributor.id],
    queryFn: ({ signal }) => fetchAgreementsForChild(distributor.id, signal),
    enabled: open,
  })
  const kiosks = useQuery({
    queryKey: ["distributor-agreement-kiosks", distributor.id],
    queryFn: fetchKiosks,
    enabled: open,
    staleTime: 10_000,
  })

  const current = currentAgreement(agreements.data ?? [])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["child-agreements"] }),
      queryClient.invalidateQueries({ queryKey: ["review-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["networkRequests"] }),
      queryClient.invalidateQueries({ queryKey: ["agreements"] }),
      queryClient.invalidateQueries({ queryKey: ["distributors"] }),
    ])
  }

  const draft = useMutation({
    mutationFn: (terms: Parameters<typeof createAgreement>[0]) => createAgreement(terms),
    onSuccess: async () => {
      toast.success("Agreement saved and activated")
      await refresh()
      setDepositAmount("")
      setNonRefundableAmount("")
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const terminate = useMutation({
    mutationFn: () => terminateAgreement(current!.id),
    onSuccess: async () => { toast.success("Agreement terminated"); await refresh() },
    onError: (error: Error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () => updateAgreement(current!.id, {
      parentSharePct: Number(parentSharePct),
      childSharePct: Number(childSharePct),
      depositAmountPerMachine: Number(depositAmount),
      nonRefundableAmountPerMachine: Number(nonRefundableAmount),
    }),
    onSuccess: async (result) => {
      toast.success(result.cascadedAgreements
        ? `Agreement updated; ${result.cascadedAgreements} partner agreement(s) synced`
        : "Agreement updated")
      setEditing(false)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const busy = draft.isPending || terminate.isPending || update.isPending

  React.useEffect(() => {
    if (!open || !current) return
    setParentSharePct(String(toNumber(current.parentSharePct)))
    setChildSharePct(String(toNumber(current.childSharePct)))
    setDepositAmount(String(toNumber(current.depositAmountPerMachine)))
    setNonRefundableAmount(String(toNumber(current.nonRefundableAmountPerMachine)))
  }, [open, current?.id])

  const submitTerms = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const [parentShare, childShare] = [Number(parentSharePct), Number(childSharePct)]
    const deposit = Number(depositAmount)
    const nonRefundable = Number(nonRefundableAmount)
    if ([parentShare, childShare].some(share => !Number.isInteger(share) || share < 0 || share > 100)) {
      setFormError("Enter whole percentages from 0 to 100.")
      return
    }
    if (parentShare + childShare !== 100) {
      setFormError("Supplier and recipient shares must total 100.")
      return
    }
    if (!Number.isInteger(deposit) || deposit < 0 || !Number.isInteger(nonRefundable) || nonRefundable < 0) {
      setFormError("Enter whole amounts of 0 or more for both per-kiosk charges.")
      return
    }
    setFormError(null)
    draft.mutate({
      childOrgId: distributor.id,
      parentSharePct: parentShare,
      childSharePct: childShare,
      depositAmountPerMachine: deposit,
      nonRefundableAmountPerMachine: nonRefundable,
    })
  }

  const submitUpdate = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !current) return
    const [parentShare, childShare] = [Number(parentSharePct), Number(childSharePct)]
    const deposit = Number(depositAmount)
    const nonRefundable = Number(nonRefundableAmount)
    if ([parentShare, childShare].some(share => !Number.isInteger(share) || share < 0 || share > 100)) {
      setFormError("Enter whole percentages from 0 to 100.")
      return
    }
    if (parentShare + childShare !== 100) {
      setFormError("Supplier and recipient shares must total 100.")
      return
    }
    if (!Number.isInteger(deposit) || deposit < 0 || !Number.isInteger(nonRefundable) || nonRefundable < 0) {
      setFormError("Enter whole amounts of 0 or more for both per-kiosk charges.")
      return
    }
    setFormError(null)
    update.mutate()
  }

  const showForm = !current

  return (
    <FullScreenDialog
      open={open}
      onOpenChange={value => {
        if (busy) return
        if (value) {
          draft.reset()
          terminate.reset()
          update.reset()
          setEditing(false)
          setFormError(null)
        }
        setOpen(value)
      }}
      trigger={
        <button
          type="button"
          aria-label={`Agreement for ${distributor.name}`}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Agreement
        </button>
      }
      title={`Agreement · ${distributor.name}`}
      description="Commercial terms between your organization and this distributor."
    >
          <div className="mt-5 space-y-5">
            {agreements.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading agreement details…
              </p>
            ) : agreements.isError ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p role="alert" className="text-destructive">
                  Couldn&apos;t load this distributor&apos;s agreement details.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (agreements.isError) void agreements.refetch()
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                {current && <AgreementSummary agreement={current} />}

                <section className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Assigned machines</p>
                    <span className="text-xs text-muted-foreground">
                      {(kiosks.data ?? []).filter(kiosk => kiosk.currentOrgId === distributor.id).length} machines
                    </span>
                  </div>
                  {kiosks.isLoading ? (
                    <p role="status" className="text-xs text-muted-foreground">Loading assigned machines…</p>
                  ) : kiosks.isError ? (
                    <p role="alert" className="text-xs text-destructive">Couldn&apos;t load assigned machines.</p>
                  ) : !(kiosks.data ?? []).filter(kiosk => kiosk.currentOrgId === distributor.id).length ? (
                    <p className="text-xs text-muted-foreground">No machines are currently assigned to this distributor.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-muted-foreground"><tr><th className="pb-2 pr-3 font-medium">Machine code</th><th className="pb-2 pr-3 font-medium">Model</th><th className="pb-2 pr-3 font-medium">Status</th><th className="pb-2 font-medium">Location</th></tr></thead>
                        <tbody className="divide-y divide-border/60">{(kiosks.data ?? []).filter(kiosk => kiosk.currentOrgId === distributor.id).map(kiosk => <tr key={kiosk.id}><td className="py-2 pr-3 font-mono font-medium">{kiosk.machineCode}</td><td className="py-2 pr-3">{kiosk.model ?? "—"}</td><td className="py-2 pr-3">{kiosk.status.replaceAll("_", " ")}</td><td className="py-2 text-muted-foreground">{kiosk.location ?? "—"}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* Termination frees the relationship's open slot, so the summary
                    disappears; confirm the outcome explicitly. */}
                {terminate.isSuccess && !current && (
                  <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                    Agreement terminated for both organizations. Draft new terms below when ready.
                  </p>
                )}

                {current?.status === "PENDING_APPROVAL" && (
                  <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Waiting for this distributor&apos;s Owner to approve the terms. A new agreement cannot be drafted until
                    they decide.
                  </p>
                )}

                {current?.status === "ACTIVE" && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Updates create a new effective version for future orders. Existing Partner agreements keep their
                      own terms, and historical orders keep their original terms.
                    </p>
                    {!editing && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setEditing(true); setFormError(null) }}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Update agreement terms
                      </button>
                    )}
                    {terminate.isError && (
                      <p role="alert" className="text-sm text-destructive">
                        {terminate.error.message}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => terminate.mutate()}
                      className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {terminate.isPending && <Loader2 size={16} className="animate-spin" />}
                      {terminate.isPending ? "Terminating…" : "Terminate agreement"}
                    </button>
                  </div>
                )}

                {editing && current?.status === "ACTIVE" && (
                  <form onSubmit={submitUpdate} className="space-y-4 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">Update agreement terms</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The current agreement will be closed historically and these terms will apply to future orders.
                        Active Partner agreements under this distributor are not changed.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`edit-parentShare-${distributor.id}`} className="mb-1.5 block text-sm font-medium">Supplier share (%)</label>
                        <input id={`edit-parentShare-${distributor.id}`} inputMode="numeric" className={inputCls} value={parentSharePct} onChange={event => setParentSharePct(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor={`edit-childShare-${distributor.id}`} className="mb-1.5 block text-sm font-medium">Recipient share (%)</label>
                        <input id={`edit-childShare-${distributor.id}`} inputMode="numeric" className={inputCls} value={childSharePct} onChange={event => setChildSharePct(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor={`edit-deposit-${distributor.id}`} className="mb-1.5 block text-sm font-medium">Total collection per kiosk</label>
                        <input id={`edit-deposit-${distributor.id}`} inputMode="numeric" className={inputCls} value={depositAmount} onChange={event => setDepositAmount(event.target.value)} />
                      </div>
                      <div>
                        <label htmlFor={`edit-nonRefundable-${distributor.id}`} className="mb-1.5 block text-sm font-medium">Non-refundable per kiosk</label>
                        <input id={`edit-nonRefundable-${distributor.id}`} inputMode="numeric" className={inputCls} value={nonRefundableAmount} onChange={event => setNonRefundableAmount(event.target.value)} />
                      </div>
                    </div>
                    {(formError || update.isError) && (
                      <p role="alert" className="text-sm text-destructive">{formError ?? update.error?.message}</p>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                        {update.isPending && <Loader2 size={16} className="animate-spin" />}
                        {update.isPending ? "Updating…" : "Save updated terms"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setEditing(false); setFormError(null) }} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {showForm && (
                  <form onSubmit={submitTerms} className="space-y-4 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">Draft agreement terms</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        These Company-to-Distributor terms activate immediately. Any partner the distributor later works
                        with can have its own Distributor-to-Partner terms.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`parentShare-${distributor.id}`} className="mb-1.5 block text-sm font-medium">
                          Supplier share (%)
                        </label>
                        <input
                          id={`parentShare-${distributor.id}`}
                          inputMode="numeric"
                          className={inputCls}
                          value={parentSharePct}
                          onChange={event => setParentSharePct(event.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor={`childShare-${distributor.id}`} className="mb-1.5 block text-sm font-medium">
                          Recipient share (%)
                        </label>
                        <input
                          id={`childShare-${distributor.id}`}
                          inputMode="numeric"
                          className={inputCls}
                          value={childSharePct}
                          onChange={event => setChildSharePct(event.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor={`deposit-${distributor.id}`} className="mb-1.5 block text-sm font-medium">
                          Total collection per kiosk
                        </label>
                        <input
                          id={`deposit-${distributor.id}`}
                          inputMode="numeric"
                          placeholder="0"
                          className={inputCls}
                          value={depositAmount}
                          onChange={event => setDepositAmount(event.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor={`nonRefundable-${distributor.id}`} className="mb-1.5 block text-sm font-medium">
                          Non-refundable per kiosk
                        </label>
                        <input
                          id={`nonRefundable-${distributor.id}`}
                          inputMode="numeric"
                          placeholder="0"
                          className={inputCls}
                          value={nonRefundableAmount}
                          onChange={event => setNonRefundableAmount(event.target.value)}
                        />
                      </div>
                    </div>
                    {(formError || draft.isError) && (
                      <p role="alert" className="text-sm text-destructive">
                        {formError ?? draft.error?.message}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {draft.isPending && <Loader2 size={16} className="animate-spin" />}
                      {draft.isPending ? "Saving…" : "Save agreement"}
                    </button>
                  </form>
                )}

                {draft.isSuccess && (
                  <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                    Agreement saved and activated for {distributor.name}.
                  </p>
                )}
              </>
            )}
          </div>
    </FullScreenDialog>
  )
}
