"use client"

import React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Search, Bell, Users, Share2, ClipboardList, ScrollText } from "lucide-react"
import Avatar from "@/components/ui/avatar"
import ThemeToggle from "@/components/dashboard/ThemeToggle"
import { useMe } from "@/hooks/useMe"
import {
  fetchOrders,
  fetchPendingMembers,
  fetchReviewRequests,
  fetchWorkflowReadiness,
} from "@/lib/backend-api"
import { gsap, prefersReducedMotion } from "@/lib/gsap"

type Notice = {
  key: string
  label: string
  href: string
  count: number
  icon: React.ReactNode
}

/**
 * The bell used to count pending *member* requests only, so it reported "You're all
 * caught up" while orders and connection requests were waiting. It now polls every
 * queue the API actually exposes and only claims there is nothing to do when all of
 * them are empty. Each entry links to the screen where the decision is made.
 */
export default function Header() {
  const { me, role, canManageMembers, isCompany, isLoading: loadingMe } = useMe()
  const [open, setOpen] = React.useState(false)
  const bellRef = React.useRef<HTMLButtonElement>(null)
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN"
  const canReview = me?.membership?.status === "ACTIVE" && isOwnerOrAdmin
  // A Company reviews connections and agreements per distributor under Distributors →
  // View More. Everyone else uses the Requests page, which is the only surface their org
  // type can reach -- Distributors is COMPANY-only, and accepting a connection requires
  // being its receiver, so a Distributor or Partner has nowhere else to approve one.
  const reviewHref = isCompany ? "/distributors" : "/requests"

  // Member requests are an organization-management concern, so they are gated the
  // same way the Users screen is.
  const members = useQuery({
    queryKey: ["pendingMembers", 1, 1],
    queryFn: () => fetchPendingMembers(1, 1),
    enabled: canManageMembers,
    refetchInterval: 10_000,
  })
  // The reviewing role is Owner/Admin, matching the API's own authorization, so no
  // request is made for someone who cannot act on the result.
  // A distinct key from the dashboard stat card, which uses ["networkRequests", 1, 1] with
  // fetchNetworkRequests. Those two calls return different shapes ({ requests } vs { data }),
  // so sharing one cache entry made each consumer read the other's fields.
  const incomingConnections = useQuery({
    queryKey: ["review-requests", "network", 1, "header"],
    queryFn: () => fetchReviewRequests("network", 1),
    enabled: canReview,
    refetchInterval: 10_000,
  })
  const pendingAgreements = useQuery({
    queryKey: ["review-requests", "agreements", 1, "header"],
    queryFn: () => fetchReviewRequests("agreements", 1),
    enabled: canReview,
    refetchInterval: 10_000,
  })
  // Orders awaiting a supplier decision. Gated on the workflow flag first, because
  // /api/orders answers 503 until the order prerequisites exist.
  const readiness = useQuery({
    queryKey: ["workflow-readiness"],
    queryFn: fetchWorkflowReadiness,
    enabled: canReview,
    refetchInterval: 30_000,
  })
  const orders = useQuery({
    queryKey: ["orders", "UNDER_REVIEW", "header"],
    queryFn: () => fetchOrders("UNDER_REVIEW"),
    enabled: canReview && readiness.data?.orderDecisions === true,
    refetchInterval: 10_000,
  })

  const organizationId = me?.membership?.organizationId
  /**
   * Incoming (someone else's) requests still awaiting our decision. The two queues
   * use different status enums -- NetworkStatus.PENDING for a connection and
   * AgreementStatus.PENDING_APPROVAL for an agreement -- so the expected status is
   * passed in rather than assumed.
   */
  const pendingIncoming = (rows: { status: string; from: { id: string } }[] | undefined, status: string) =>
    (rows ?? []).filter(row => row.status === status && row.from.id !== organizationId).length

  // Only costs the supplier's own queue: the API returns both directions.
  const ordersAwaitingSupplier = (orders.data ?? []).filter(
    order => order.parentOrgId === organizationId && order.paymentStatus === "PENDING"
  ).length

  const notices: Notice[] = []
  if (canManageMembers && (members.data?.meta?.total ?? 0) > 0) {
    notices.push({
      key: "members",
      label: "Member requests",
      href: "/user",
      count: members.data!.meta.total,
      icon: <Users size={15} />,
    })
  }
  if (canReview && pendingIncoming(incomingConnections.data?.requests, "PENDING") > 0) {
    notices.push({
      key: "connections",
      label: "Connection requests",
      href: reviewHref,
      count: pendingIncoming(incomingConnections.data?.requests, "PENDING"),
      icon: <Share2 size={15} />,
    })
  }
  if (canReview && pendingIncoming(pendingAgreements.data?.requests, "PENDING_APPROVAL") > 0) {
    notices.push({
      key: "agreements",
      label: "Agreements to approve",
      href: reviewHref,
      count: pendingIncoming(pendingAgreements.data?.requests, "PENDING_APPROVAL"),
      icon: <ScrollText size={15} />,
    })
  }
  if (canReview && ordersAwaitingSupplier > 0) {
    notices.push({
      key: "orders",
      label: "Orders awaiting approval",
      href: "/orders",
      count: ordersAwaitingSupplier,
      icon: <ClipboardList size={15} />,
    })
  }

  const total = notices.reduce((sum, notice) => sum + notice.count, 0)
  // "All caught up" may only appear once every queue we asked about has answered;
  // otherwise an in-flight request reads as no outstanding work. Disabled queries
  // report isLoading false, so a gated queue never blocks the state.
  const queuesLoading =
    loadingMe ||
    (canManageMembers && members.isLoading) ||
    (canReview &&
      (incomingConnections.isLoading || pendingAgreements.isLoading || readiness.isLoading || orders.isLoading))

  // Pop the badge when the count first becomes positive.
  React.useEffect(() => {
    if (total > 0 && bellRef.current && !prefersReducedMotion()) {
      const dot = bellRef.current.querySelector("[data-badge]")
      if (dot) gsap.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.4, ease: "back.out(2)" })
    }
  }, [total])

  // The bell is shown to anyone who can manage one of these queues.
  const showBell = canManageMembers || canReview

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <div className="relative hidden sm:block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search"
            className="w-56 rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            placeholder="Search…"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <ThemeToggle />
        {showBell && (
          <div className="relative">
            <button
              ref={bellRef}
              onClick={() => setOpen((v) => !v)}
              aria-label={`Notifications${total ? ` (${total})` : ""}`}
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell size={18} />
              {total > 0 && (
                <span
                  data-badge
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                >
                  {total}
                </span>
              )}
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-lg">
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Pending work</p>
                  {/* "All caught up" is only shown once every queue has answered, so a
                      still-loading queue can never read as no outstanding work. */}
                  {queuesLoading ? (
                    <p className="px-2 py-3 text-center text-sm text-muted-foreground">Checking for pending work…</p>
                  ) : notices.length === 0 ? (
                    <p className="px-2 py-3 text-center text-sm text-muted-foreground">You&apos;re all caught up 🎉</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {notices.map(notice => (
                        <li key={notice.key} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted">
                          <Link href={notice.href} onClick={() => setOpen(false)} className="inline-flex items-center gap-2">
                            {notice.icon} {notice.label}
                          </Link>
                          <span className="font-semibold tabular-nums">{notice.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <Avatar name={me?.name ?? "User"} />
      </div>
    </header>
  )
}
