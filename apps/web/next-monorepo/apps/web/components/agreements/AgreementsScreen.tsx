"use client"

import React from "react"
import { useMe } from "@/hooks/useMe"
import { EmptyState, Skeleton } from "@/components/dashboard/ui"
import ReviewRequestList from "@/components/requests/ReviewRequestList"

/** Dedicated agreement list. Network connections are intentionally not rendered here. */
export default function AgreementsScreen() {
  const { canReviewRequests, isLoading } = useMe()
  const [page, setPage] = React.useState(1)

  if (isLoading) return <Skeleton className="h-64" />
  if (!canReviewRequests) {
    return <EmptyState message="Only organization Owners and Admins can review agreements." />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agreements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review agreement terms and approval status for your organization.
        </p>
      </header>
      <ReviewRequestList kind="agreements" page={page} onPageChange={setPage} />
    </div>
  )
}
