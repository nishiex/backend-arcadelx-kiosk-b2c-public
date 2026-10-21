"use client"

import React from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@workspace/ui/lib/utils"
import {
  createAgreement,
  fetchAgreementsForChild,
  fetchOrganizationConnections,
  initiateConnection,
  terminateAgreement,
  type Agreement,
  type Distributor,
  type NetworkConnection,
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

/**
 * Whether terms can be drafted: the connection must be ACTIVE *and* initiated by
 * this organization, because the API rejects parents that are not the initiator.
 * A later page can hold the current link, so the last matching row wins.
 */
function activeConnection(connections: NetworkConnection[], distributorId: string, organizationId: string) {
  return connections
    .filter(row => row.receiverOrgId === distributorId && row.initiatorOrgId === organizationId && row.status === "ACTIVE")
    .pop()
}

/** The latest Company-initiated network request for this distributor, whatever its status. */
function organizationConnection(connections: NetworkConnection[], distributorId: string, organizationId: string) {
  return connections
    .filter(row => row.receiverOrgId === distributorId && row.initiatorOrgId === organizationId)
    .pop()
}

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
  const queryClient = useQueryClient()

  const connections = useQuery({
    queryKey: ["network-connections", organizationId],
    queryFn: ({ signal }) => fetchOrganizationConnections(signal),
    enabled: open,
  })
  const agreements = useQuery({
    queryKey: ["child-agreements", organizationId, distributor.id],
    queryFn: ({ signal }) => fetchAgreementsForChild(distributor.id, signal),
    enabled: open,
  })

  const connectionRequest = organizationConnection(connections.data ?? [], distributor.id, organizationId)
  const connection = activeConnection(connections.data ?? [], distributor.id, organizationId)
  const current = currentAgreement(agreements.data ?? [])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["network-connections"] }),
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
      toast.success("Agreement submitted for approval")
      await refresh()
      setDepositAmount("")
      setNonRefundableAmount("")
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const sendConnectionRequest = useMutation({
    mutationFn: () => {
      const email = distributor.owner?.email
      if (!email) throw new Error("This distributor does not have an owner email yet.")
      return initiateConnection(email)
    },
    onSuccess: async () => {
      toast.success("Connection request sent")
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const terminate = useMutation({
    mutationFn: () => terminateAgreement(current!.id),
    onSuccess: async () => { toast.success("Agreement terminated"); await refresh() },
    onError: (error: Error) => toast.error(error.message),
  })

  const busy = draft.isPending || sendConnectionRequest.isPending || terminate.isPending

  const submitTerms = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !connection) return
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
      networkConnectionId: connection.id,
      parentSharePct: parentShare,
      childSharePct: childShare,
      depositAmountPerMachine: deposit,
      nonRefundableAmountPerMachine: nonRefundable,
    })
  }

  const showForm = Boolean(connection) && !current

  return (
    <Dialog.Root
      open={open}
      onOpenChange={value => {
        if (busy) return
        if (value) {
          draft.reset()
          sendConnectionRequest.reset()
          terminate.reset()
          setFormError(null)
        }
        setOpen(value)
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Agreement for ${distributor.name}`}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Agreement
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:p-6">
          <Dialog.Title className="pr-10 text-xl font-semibold">Agreement · {distributor.name}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            Commercial terms between your organization and this distributor.
          </Dialog.Description>
          <Dialog.Close
            disabled={busy}
            aria-label="Close agreement"
            className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted disabled:opacity-50"
          >
            <X size={18} />
          </Dialog.Close>

          <div className="mt-5 space-y-5">
            {connections.isLoading || agreements.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading agreement details…
              </p>
            ) : connections.isError || agreements.isError ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p role="alert" className="text-destructive">
                  Couldn&apos;t load this distributor&apos;s agreement details.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (connections.isError) void connections.refetch()
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
                      These terms stay in force until the agreement is terminated. Termination closes the agreement for both
                      organizations and cannot be undone here.
                    </p>
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

                {!connection && !current && !connectionRequest && (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <p role="status" className="text-muted-foreground">
                      No active network connection exists yet. Send a request to {distributor.owner?.email ?? "this distributor's Owner"} before drafting agreement terms.
                    </p>
                    {distributor.owner?.email ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => sendConnectionRequest.mutate()}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {sendConnectionRequest.isPending && <Loader2 size={16} className="animate-spin" />}
                        {sendConnectionRequest.isPending ? "Sending…" : "Send connection request"}
                      </button>
                    ) : (
                      <p className="text-xs text-muted-foreground">The distributor owner email is unavailable.</p>
                    )}
                  </div>
                )}

                {!connection && !current && connectionRequest?.status === "PENDING" && (
                  <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                    A connection request is awaiting this distributor&apos;s decision. <Link href="/requests" className="font-medium underline underline-offset-2">Track it in Requests</Link>
                  </p>
                )}

                {!connection && !current && connectionRequest?.status === "REJECTED" && (
                  <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                    This distributor declined the previous connection request.
                  </p>
                )}

                {showForm && (
                  <form onSubmit={submitTerms} className="space-y-4 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">Draft agreement terms</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The distributor&apos;s Owner must approve these terms before they take effect. Any partner they later
                        register is charged the same per-kiosk amounts as this agreement defines.
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
                          Deposit per kiosk
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
                      {draft.isPending ? "Sending for approval…" : "Send for approval"}
                    </button>
                  </form>
                )}

                {draft.isSuccess && (
                  <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                    Agreement drafted and sent to {distributor.name}&apos;s Owner for approval.
                  </p>
                )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
