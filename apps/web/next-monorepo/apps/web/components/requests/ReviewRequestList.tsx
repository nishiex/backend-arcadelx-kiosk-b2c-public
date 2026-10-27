"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { Inbox } from "lucide-react"
import { fetchReviewRequests, type NetworkKioskRef } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"
import { orderDate, orderMoney } from "@/components/orders/order-display"
import DecisionDialog from "./DecisionDialog"

function AssignedKioskInventory({ kiosks }: { kiosks?: NetworkKioskRef[] }) {
  if (!kiosks) return null
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Assigned kiosk inventory</p>
        <span className="text-xs text-muted-foreground">{kiosks.length} kiosk{kiosks.length === 1 ? "" : "s"}</span>
      </div>
      {kiosks.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-medium">Machine Code</th>
                <th className="pb-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {kiosks.map((kiosk) => (
                <tr key={kiosk.machineCode}>
                  <td className="py-2 pr-4 font-mono font-medium">{kiosk.machineCode}</td>
                  <td className="py-2">{kiosk.model ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No kiosks are currently held by this organization.</p>
      )}
    </div>
  )
}

/**
 * The network-connection / agreement review list.
 *
 * Extracted from `RequestsScreen` so the Requests page and the Distributors
 * "View More" dialog render the same list instead of two copies of it. Controlled
 * component: the parent owns `kind` and `page`, which is what lets the dialog drive
 * it from its own tab row.
 *
 * Behaviour is unchanged from `RequestsScreen`: same query keys (so the cache is
 * shared), the same 10s refetch, the same readiness probe, the same empty/error/
 * loading states, and the same authorization rules --
 *   - a connection request may be accepted by OWNER or ADMIN,
 *   - an agreement may be approved by OWNER only.
 */
export default function ReviewRequestList({
  kind,
  page,
  onPageChange,
  counterpartyId,
}: {
  kind: "network" | "agreements"
  page: number
  onPageChange: (page: number) => void
  /** When set, only rows involving this organization are listed. */
  counterpartyId?: string
}) {
  const { me, role, orgType, canReviewRequests } = useMe()
  const organizationId = me?.membership?.organizationId
  const isMasterAdmin = me?.membership?.status === "ACTIVE" &&
    me.membership.organization.type === "COMPANY" && me.membership.role === "OWNER"
  const canViewNetworkInventory = isMasterAdmin ||
    (me?.membership?.status === "ACTIVE" && me.membership.organization.type === "DISTRIBUTOR")
  const query = useQuery({
    queryKey: ["review-requests", organizationId, kind, page],
    queryFn: () => fetchReviewRequests(kind, page),
    enabled: canReviewRequests,
    refetchInterval: 10_000,
  })
  const pages = Math.max(1, query.data?.meta.totalPages ?? 1)
  // Keep the caller's page within range once the server reports the real total.
  React.useEffect(() => {
    if (query.data && page > pages) onPageChange(pages)
  }, [query.data, page, pages, onPageChange])

  if (!canReviewRequests) {
    return <EmptyState message="Only organization Owners and Admins can review requests." />
  }

  // The API pages the whole organization's history, so a distributor-scoped view
  // filters the rows it was given rather than pretending the count is scoped too.
  const all = query.data?.requests ?? []
  const rows = counterpartyId
    ? all.filter(request => request.from.id === counterpartyId || request.to.id === counterpartyId)
    : all

  return (
    <>
      {kind === "agreements" && orgType === "PARTNER" && (
        <p className="text-sm text-muted-foreground">
          Agreement terms are view-only for Partners. Discuss any changes with the Company or Distributor directly.
        </p>
      )}
      {kind === "agreements" && orgType !== "PARTNER" && role !== "OWNER" && (
        <p className="text-sm text-muted-foreground">
          Only your organization&apos;s Owner can approve financial agreements.
        </p>
      )}
      <section className="rounded-xl border border-border bg-card" aria-busy={query.isFetching}>
        {query.isLoading ? (
          <div className="space-y-4 p-5">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : query.isError ? (
          <ErrorState message="Couldn't load requests." onRetry={() => query.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            className="py-14"
            icon={<Inbox size={28} />}
            message={counterpartyId ? "No requests with this distributor." : "No requests yet."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(request => {
              const incoming = request.to.id === organizationId
              const pending = request.status === "PENDING" || request.status === "PENDING_APPROVAL"
              const canDecide = orgType !== "PARTNER" && incoming && pending && (kind === "network" || role === "OWNER")
              const subject = `${kind === "network" ? "Connection" : "Agreement"} from ${request.from.name}`
              const counterparty = request.from.id === organizationId ? request.to : request.from
              return (
                <li key={request.id} className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {request.from.name} <span className="text-muted-foreground">→</span> {request.to.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {incoming ? "Incoming" : "Outgoing"} · {orderDate(request.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        request.status === "REJECTED"
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : pending
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {request.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  {kind === "agreements" && (
                    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Supplier share</dt>
                        <dd>{request.parentSharePct}%</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Recipient share</dt>
                        <dd>{request.childSharePct}%</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Total collection / kiosk</dt>
                        <dd>{orderMoney(request.depositAmountPerMachine ?? 0)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Non-refundable / kiosk</dt>
                        <dd>{orderMoney(request.nonRefundableAmountPerMachine ?? 0)}</dd>
                      </div>
                    </dl>
                  )}
                  {kind === "network" && canViewNetworkInventory && (
                    <AssignedKioskInventory kiosks={counterparty.kiosks} />
                  )}
                  {canDecide && (
                    <div className="flex justify-end gap-2">
                      <DecisionDialog kind={kind} id={request.id} subject={subject} action="approve" />
                    </div>
                  )}
                  {!incoming && pending && (
                    <p className="text-xs text-muted-foreground">Awaiting the recipient&apos;s decision.</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {query.data && !query.isError && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <p role="status">
              {counterpartyId ? `${rows.length} of ${query.data.meta.total}` : query.data.meta.total} requests · Page{" "}
              {page} of {pages}
              {query.isFetching && " · Updating…"}
            </p>
            <nav aria-label="Request pagination" className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || query.isFetching}
                onClick={() => onPageChange(page - 1)}
                className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages || query.isFetching}
                onClick={() => onPageChange(page + 1)}
                className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          </footer>
        )}
      </section>
    </>
  )
}
