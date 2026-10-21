"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { ClipboardList, Download, RefreshCw, Search } from "lucide-react"
import { fetchOrders, fetchWorkflowReadiness, ORDER_STATUSES, type OrderStatus } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"
import OrderDetailsDialog from "./OrderDetailsDialog"
import OrderStatusDialog from "./OrderStatusDialog"
import CreateOrderDialog from "./CreateOrderDialog"
import DecisionDialog from "@/components/requests/DecisionDialog"
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES, orderDate, orderPerspective } from "./order-display"

const control = "rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

export default function OrdersScreen() {
  const { me, role, orgType, isLoading: loadingMe, isError: identityError } = useMe()
  const organizationId = me?.membership?.organizationId
  const canDecide = me?.membership?.status === "ACTIVE" && (role === "OWNER" || role === "ADMIN")
  const canApproveOrders = canDecide && (orgType === "COMPANY" || orgType === "DISTRIBUTOR")
  const canRequest = !identityError && canDecide && (orgType === "DISTRIBUTOR" || orgType === "PARTNER")
  const [createdMessage, setCreatedMessage] = React.useState("")
  const readiness = useQuery({ queryKey: ["workflow-readiness"], queryFn: fetchWorkflowReadiness, enabled: !!organizationId && canDecide, refetchInterval: 30_000 })
  const orderActionsDisabled = readiness.isError || !readiness.data?.orderDecisions
  const [search, setSearch] = React.useState("")
  const [status, setStatus] = React.useState<OrderStatus | "">("")
  const [direction, setDirection] = React.useState("")
  const orders = useQuery({
    queryKey: ["orders", organizationId, status],
    queryFn: ({ signal }) => fetchOrders(status || undefined, signal),
    enabled: !!organizationId,
    staleTime: 15000,
    refetchInterval: 30000,
  })
  const filtered = (orders.data ?? []).filter(order =>
    order.orderNumber.toLowerCase().includes(search.trim().toLowerCase()) &&
    (!direction || orderPerspective(order, organizationId ?? "").direction === direction)
  )
  const loading = loadingMe || (!!organizationId && orders.isLoading)
  const hasFilters = !!(search.trim() || status || direction)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Orders &amp; Requests</h1><p className="mt-1 text-sm text-muted-foreground">Track incoming requests and outgoing machine allocations, including completed deliveries.</p></div>
        <div className="flex flex-wrap gap-2">
          {canRequest && organizationId && orgType && <CreateOrderDialog key={organizationId} organizationId={organizationId} orgType={orgType} disabled={orderActionsDisabled} onCreated={order => {
            setSearch(""); setStatus(""); setDirection("")
            setCreatedMessage(`Request ${order.orderNumber} for ${order.quantity} ${order.requestedModel ?? "kiosk"} kiosk(s) submitted for supplier approval.`)
          }} />}
          <button type="button" onClick={() => orders.refetch()} disabled={!organizationId || orders.isFetching} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><RefreshCw size={16} className={orders.isFetching ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </div>
      {createdMessage && <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{createdMessage}</p>}
      {canRequest && readiness.isLoading && <p role="status" className="text-sm text-muted-foreground">Checking kiosk request availability...</p>}
      {canDecide && readiness.data && !readiness.data.orderDecisions && <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">Order requests and decisions are temporarily unavailable. Please contact your administrator.</p>}
      {canDecide && readiness.isError && <ErrorState message="Couldn't check order action availability." onRetry={() => readiness.refetch()} />}
      <div className="overflow-hidden rounded-xl border border-border bg-card" aria-busy={orders.isFetching}>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row">
          <div className="relative min-w-0 flex-1"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search order number" placeholder="Search order number…" value={search} onChange={event => setSearch(event.target.value)} className={`${control} w-full pl-10`} /></div>
          <select aria-label="Filter order status" value={status} onChange={event => setStatus(event.target.value as OrderStatus | "")} className={`${control} lg:w-48`}><option value="">All statuses</option>{ORDER_STATUSES.map(value => <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>)}</select>
          <select aria-label="Filter order direction" value={direction} onChange={event => setDirection(event.target.value)} className={`${control} lg:w-48`}><option value="">All directions</option><option value="INCOMING">Incoming</option><option value="OUTGOING">Outgoing</option></select>
        </div>
        {loading ? (
          <div role="status" aria-label="Loading orders" className="space-y-4 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : identityError ? (
          <ErrorState message="Couldn't verify your account. Reload the page to try again." />
        ) : !organizationId ? (
          <EmptyState message="Join an organization to view its orders." />
        ) : orders.isError ? (
          <ErrorState message="Couldn't load orders." onRetry={() => orders.refetch()} />
        ) : !filtered.length ? (
          <EmptyState className="py-14" icon={<ClipboardList size={28} />} message={hasFilters ? "No orders match your filters." : "No orders yet. Orders will appear here when a machine request or allocation is created."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left text-sm">
              <caption className="sr-only">Orders and requests involving your organization</caption>
              <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>{["Order number", "Direction", "Counterparty", "Qty", "Order status", "Payment status", "Date", "Actions"].map(label => <th key={label} scope="col" className={`px-4 py-3 font-medium ${label === "Actions" ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
              <tbody>{filtered.map(order => {
                const view = orderPerspective(order, organizationId)
                return (
                  <tr key={order.id} className="border-t border-border transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-4"><p className="font-mono font-semibold">{order.orderNumber}</p><p className="mt-1 text-xs text-muted-foreground">{order.type === "REQUEST" ? "Machine request" : "Machine allocation"}</p></td>
                    <td className="px-4 py-4"><span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{view.flow}</span></td>
                    <td className="px-4 py-4"><p className="font-medium">{view.counterparty.name}</p><p className="mt-1 text-xs text-muted-foreground">{view.description}</p></td>
                    <td className="px-4 py-4 tabular-nums">{order.quantity}</td>
                    <td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${ORDER_STATUS_STYLES[order.status]}`}>{ORDER_STATUS_LABELS[order.status]}</span></td>
                    <td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${PAYMENT_STATUS_STYLES[order.paymentStatus] ?? "bg-muted text-muted-foreground"}`}>{PAYMENT_STATUS_LABELS[order.paymentStatus] ?? "Unknown"}</span></td>
                    <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">{orderDate(order.createdAt)}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canApproveOrders && order.parentOrgId === organizationId && order.type === "REQUEST" && order.status === "UNDER_REVIEW" && order.paymentStatus === "PENDING" && (
                          <DecisionDialog kind="orders" id={order.id} subject={order.orderNumber} action="approve" disabled={orderActionsDisabled} />
                        )}
                        {/* Supplier-only lifecycle steps. The API independently
                            requires the caller to be the parent organization. */}
                        {canApproveOrders && order.parentOrgId === organizationId && (
                          <OrderStatusDialog order={order} disabled={orderActionsDisabled} />
                        )}
                        {order.status === "DELIVERED" && (
                          <a
                            href={`/api/orders/${encodeURIComponent(order.id)}/invoice`}
                            download={`${order.orderNumber}-invoice.pdf`}
                            aria-label={`Download invoice for ${order.orderNumber}`}
                            className="inline-flex items-center gap-2 rounded-md border border-primary px-2.5 py-2 font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <Download size={16} /> Invoice
                          </a>
                        )}
                        <OrderDetailsDialog order={order} organizationId={organizationId} />
                      </div>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
        {!loading && !identityError && !orders.isError && organizationId && <p role="status" className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{filtered.length} order{filtered.length === 1 ? "" : "s"}{hasFilters ? " matching your filters" : ""}</p>}
      </div>
    </div>
  )
}
