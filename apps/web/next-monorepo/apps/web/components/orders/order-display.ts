import type { KioskOrder, OrderStatus, OrgType } from "@/lib/backend-api"

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  REJECTED: "Rejected",
}

export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  UNDER_REVIEW: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  DISPATCHED: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  DELIVERED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-red-500/10 text-red-700 dark:text-red-300",
}

export const PAYMENT_STATUS_LABELS: Record<KioskOrder["paymentStatus"], string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
}

export const PAYMENT_STATUS_STYLES: Record<KioskOrder["paymentStatus"], string> = {
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  PAID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-300",
  REFUNDED: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
}

const orgLabels: Record<OrgType, string> = { COMPANY: "Company", DISTRIBUTOR: "Distributor", PARTNER: "Partner" }
export const orderDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value))
export const orderMoney = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(value)

export function orderPerspective(order: KioskOrder, organizationId: string) {
  const sender = order.type === "REQUEST" ? order.childOrg : order.parentOrg
  const receiver = order.type === "REQUEST" ? order.parentOrg : order.childOrg
  const outgoing = sender.id === organizationId
  return {
    direction: outgoing ? "OUTGOING" : "INCOMING",
    flow: `${orgLabels[sender.type]} → ${orgLabels[receiver.type]}`,
    counterparty: order.parentOrgId === organizationId ? order.childOrg : order.parentOrg,
    description: order.type === "REQUEST"
      ? (outgoing ? "Requested by us" : "Requested from us")
      : (outgoing ? "Allocated by us" : "Allocated to us"),
  }
}
