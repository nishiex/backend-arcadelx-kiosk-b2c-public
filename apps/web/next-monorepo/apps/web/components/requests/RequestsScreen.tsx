"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { Inbox } from "lucide-react"
import { fetchReviewRequests, fetchWorkflowReadiness } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"
import { orderDate, orderMoney } from "@/components/orders/order-display"
import DecisionDialog from "./DecisionDialog"

export default function RequestsScreen() {
  const { me, role, canReviewRequests, isLoading } = useMe()
  const organizationId = me?.membership?.organizationId
  const [kind, setKind] = React.useState<"network" | "agreements">("network")
  const [page, setPage] = React.useState(1)
  const [pageOrganizationId, setPageOrganizationId] = React.useState(organizationId)
  const query = useQuery({ queryKey: ["review-requests", organizationId, kind, page], queryFn: () => fetchReviewRequests(kind, page), enabled: canReviewRequests, refetchInterval: 10_000 })
  const readiness = useQuery({ queryKey: ["workflow-readiness"], queryFn: fetchWorkflowReadiness, enabled: canReviewRequests, refetchInterval: 30_000 })
  const pages = Math.max(1, query.data?.meta.totalPages ?? 1)
  if (pageOrganizationId !== organizationId) {
    setPageOrganizationId(organizationId)
    setPage(1)
  } else if (query.data && page > pages) setPage(pages)
  if (isLoading) return <Skeleton className="h-64" />
  if (!canReviewRequests) return <EmptyState message="Only organization Owners and Admins can review requests." />
  const rejectionReady = kind === "network" ? readiness.data?.networkRejection : readiness.data?.agreementRejection
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">Requests</h1><p className="mt-1 text-sm text-muted-foreground">Review incoming connections and agreements, and track your request history.</p></header>
      <div className="flex gap-2" aria-label="Request type">{(["network", "agreements"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setPage(1) }} className={`rounded-lg border px-4 py-2 text-sm font-medium ${kind === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}>{value === "network" ? "Network connections" : "Agreements"}</button>)}</div>
      {kind === "agreements" && role !== "OWNER" && <p className="text-sm text-muted-foreground">Only your organization’s Owner can approve or reject financial agreements.</p>}
      {readiness.isError && <ErrorState message="Couldn't check action availability." onRetry={() => readiness.refetch()} />}
      {readiness.data && !rejectionReady && <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">Rejection is temporarily unavailable. Please contact your administrator.</p>}
      <section className="rounded-xl border border-border bg-card" aria-busy={query.isFetching}>
        {query.isLoading ? <div className="space-y-4 p-5"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          : query.isError ? <ErrorState message="Couldn't load requests." onRetry={() => query.refetch()} />
            : !query.data?.requests.length ? <EmptyState className="py-14" icon={<Inbox size={28} />} message="No requests yet." />
              : <ul className="divide-y divide-border">{query.data.requests.map(request => {
                const incoming = request.to.id === organizationId
                const pending = request.status === "PENDING" || request.status === "PENDING_APPROVAL"
                const canDecide = incoming && pending && (kind === "network" || role === "OWNER")
                const subject = `${kind === "network" ? "Connection" : "Agreement"} from ${request.from.name}`
                return <li key={request.id} className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-medium">{request.from.name} <span className="text-muted-foreground">→</span> {request.to.name}</p><p className="mt-1 text-xs text-muted-foreground">{incoming ? "Incoming" : "Outgoing"} · {orderDate(request.createdAt)}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${request.status === "REJECTED" ? "bg-red-500/10 text-red-600 dark:text-red-400" : pending ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{request.status.replaceAll("_", " ")}</span>
                  </div>
                  {kind === "agreements" && <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Supplier share</dt><dd>{request.parentSharePct}%</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Recipient share</dt><dd>{request.childSharePct}%</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Deposit / kiosk</dt><dd>{orderMoney(request.depositAmountPerMachine ?? 0)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Non-refundable / kiosk</dt><dd>{orderMoney(request.nonRefundableAmountPerMachine ?? 0)}</dd></div>
                  </dl>}
                  {canDecide && <div className="flex justify-end gap-2"><DecisionDialog kind={kind} id={request.id} subject={subject} action="reject" disabled={!rejectionReady} /><DecisionDialog kind={kind} id={request.id} subject={subject} action="approve" /></div>}
                  {!incoming && pending && <p className="text-xs text-muted-foreground">Awaiting the recipient’s decision.</p>}
                </li>
              })}</ul>}
        {query.data && !query.isError && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground"><p role="status">{query.data.meta.total} requests · Page {page} of {pages}{query.isFetching && " · Updating…"}</p><nav aria-label="Request pagination" className="flex gap-2"><button type="button" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Previous</button><button type="button" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Next</button></nav></footer>}
      </section>
    </div>
  )
}
