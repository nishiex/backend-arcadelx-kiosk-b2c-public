"use client"

import React from "react"
import { useMe } from "@/hooks/useMe"
import { EmptyState, Skeleton } from "@/components/dashboard/ui"
import ReviewRequestList from "./ReviewRequestList"

/**
 * The standalone Requests page.
 *
 * The list itself lives in `ReviewRequestList`, which the Company's
 * Distributors → View More dialog also renders.
 *
 * A Company no longer uses this page: its navigation points at Distributors instead, so
 * this renders an explanatory state rather than the list. The route is kept (not deleted)
 * because DISTRIBUTOR and PARTNER members still need it -- the Distributors page is
 * Company-only, so accepting a connection has nowhere else to happen for them.
 */
export default function RequestsScreen() {
  const { me, isCompany, canReviewRequests, isLoading } = useMe()
  const organizationId = me?.membership?.organizationId
  const [kind, setKind] = React.useState<"network" | "agreements">("network")
  const [page, setPage] = React.useState(1)
  const [pageOrganizationId, setPageOrganizationId] = React.useState(organizationId)

  // A different organization means the old page number is meaningless.
  if (pageOrganizationId !== organizationId) {
    setPageOrganizationId(organizationId)
    setPage(1)
  }

  if (isLoading) return <Skeleton className="h-64" />
  if (isCompany) {
    return (
      <EmptyState message="Connection and agreement requests are reviewed per distributor, under Distributors → View More." />
    )
  }
  if (!canReviewRequests)
    return <EmptyState message="Only organization Owners and Admins can review requests." />

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review incoming connections and agreements, and track your request history.
        </p>
      </header>
      <div className="flex gap-2" aria-label="Request type">
        {(["network", "agreements"] as const).map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value)
              setPage(1)
            }}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              kind === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            {value === "network" ? "Network connections" : "Agreements"}
          </button>
        ))}
      </div>
      <ReviewRequestList kind={kind} page={page} onPageChange={setPage} />
    </div>
  )
}
