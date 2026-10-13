"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Eye, X } from "lucide-react"
import { fetchOrderDetails, type KioskOrder } from "@/lib/backend-api"
import { ErrorState, Skeleton } from "@/components/dashboard/ui"
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, orderDate, orderMoney, orderPerspective } from "./order-display"

export default function OrderDetailsDialog({ order, organizationId }: { order: KioskOrder; organizationId: string }) {
  const [open, setOpen] = React.useState(false)
  const details = useQuery({
    queryKey: ["orders", organizationId, "detail", order.id],
    queryFn: ({ signal }) => fetchOrderDetails(order.id, signal),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 30000 : false,
  })
  const data = details.data

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={`View order ${order.orderNumber}`} className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <Eye size={16} /> View
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
          <div className="border-b border-border p-5 pr-14 sm:p-6 sm:pr-14">
            <Dialog.Title className="break-words font-mono text-lg font-semibold">{order.orderNumber}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">Order details and linked kiosks.</Dialog.Description>
            <Dialog.Close aria-label="Close order details" className="absolute right-4 top-4 rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X size={18} /></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
            {details.isLoading ? (
              <div role="status" aria-label="Loading order details" className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-36" /></div>
            ) : details.isError ? (
              <ErrorState message="Couldn't load this order." onRetry={() => details.refetch()} />
            ) : data ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-medium">{orderPerspective(data, organizationId).counterparty.name}</p><p className="mt-1 text-sm text-muted-foreground">{orderPerspective(data, organizationId).flow}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${ORDER_STATUS_STYLES[data.status]}`}>{ORDER_STATUS_LABELS[data.status]}</span>
                </div>
                <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-muted/20 p-4 text-sm sm:grid-cols-5">
                  <div><dt className="text-muted-foreground">Type</dt><dd className="mt-1 font-medium">{data.type === "REQUEST" ? "Machine request" : "Machine allocation"}</dd></div>
                  <div><dt className="text-muted-foreground">Quantity</dt><dd className="mt-1 font-medium">{data.quantity}</dd></div>
                  <div><dt className="text-muted-foreground">Requested model</dt><dd className="mt-1 font-medium">{data.requestedModel ?? "Any model"}</dd></div>
                  <div><dt className="text-muted-foreground">Payment</dt><dd className="mt-1 font-medium">{data.paymentStatus.charAt(0) + data.paymentStatus.slice(1).toLowerCase()}</dd></div>
                  <div><dt className="text-muted-foreground">Created</dt><dd className="mt-1 font-medium">{orderDate(data.createdAt)}</dd></div>
                </dl>
                <section aria-label="Linked kiosks">
                  <h3 className="mb-3 text-sm font-semibold">Linked kiosks ({data.dispatchedKiosks.length})</h3>
                  {!["UNDER_REVIEW", "REJECTED"].includes(data.status) && data.dispatchedKiosks.length !== data.quantity && (
                    <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">This order records {data.quantity} kiosks, but {data.dispatchedKiosks.length} are linked. Its assignment details need checking.</p>
                  )}
                  {data.dispatchedKiosks.length ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Kiosk</th><th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">Current status</th></tr></thead>
                        <tbody>{data.dispatchedKiosks.map(({ kiosk }) => <tr key={kiosk.id} className="border-t border-border"><td className="whitespace-nowrap px-3 py-3 font-mono">{kiosk.machineCode}</td><td className="px-3 py-3">{kiosk.model ?? "—"}</td><td className="px-3 py-3 text-xs">{kiosk.status.replaceAll("_", " ")}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No kiosks are linked to this order yet.</p>}
                </section>
                <section aria-label="Order totals" className="border-t border-border pt-4">
                  <h3 className="mb-3 text-sm font-semibold">Order totals</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Deposit</dt><dd>{orderMoney(data.totalDeposit)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Non-refundable fee</dt><dd>{orderMoney(data.totalNonRefundable)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tax</dt><dd>{orderMoney(data.taxAmount)}</dd></div>
                    <div className="flex justify-between gap-4 border-t border-border pt-3 font-semibold"><dt>Grand total</dt><dd>{orderMoney(data.grandTotal)}</dd></div>
                  </dl>
                </section>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
