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
 * Network request history is a Company Master Admin view. Agreement review remains
 * available through its dedicated page and organization-specific dialogs.
 */
export default function RequestsScreen() {
  const { me, canReviewNetworkRequests, isLoading } = useMe()
  const organizationId = me?.membership?.organizationId
  const [page, setPage] = React.useState(1)
  const [pageOrganizationId, setPageOrganizationId] = React.useState(organizationId)

  // A different organization means the old page number is meaningless.
  if (pageOrganizationId !== organizationId) {
    setPageOrganizationId(organizationId)
    setPage(1)
  }

  if (isLoading) return <Skeleton className="h-64" />
  if (!canReviewNetworkRequests)
    return <EmptyState message="Only the Company Master Admin can review network requests." />

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review incoming network connection requests and track your outgoing request history.
        </p>
      </header>
      <ReviewRequestList kind="network" page={page} onPageChange={setPage} />
    </div>
  )
}
