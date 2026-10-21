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
 * All organization types use this page when they open Network from the sidebar. Company
 * users also reach the same review list from Distributors → View More, but keeping the
 * full list here makes the Network navigation useful and shows the request cards directly.
 */
export default function RequestsScreen() {
  const { me, canReviewRequests, isLoading } = useMe()
  const organizationId = me?.membership?.organizationId
  const [page, setPage] = React.useState(1)
  const [pageOrganizationId, setPageOrganizationId] = React.useState(organizationId)

  // A different organization means the old page number is meaningless.
  if (pageOrganizationId !== organizationId) {
    setPageOrganizationId(organizationId)
    setPage(1)
  }

  if (isLoading) return <Skeleton className="h-64" />
  if (!canReviewRequests)
    return <EmptyState message="Only organization Owners and Admins can review requests." />

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review incoming network connection requests and track your request history.
        </p>
      </header>
      <ReviewRequestList kind="network" page={page} onPageChange={setPage} />
    </div>
  )
}
