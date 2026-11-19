"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useMe } from "@/hooks/useMe"
import { Skeleton } from "@/components/dashboard/ui"

// Session gate for the dashboard CONTENT. fetchMe() already single-flights a token
// refresh on 401, so `isError` here means the session is genuinely dead (the access
// token expired AND the refresh failed). When that happens we drop any stale cache
// and send the user to /login instead of leaving them on a page full of failed
// requests.
//
// The shell (Sidebar/Header) renders outside this gate, so while the first
// /api/auth/me request is in flight the user sees the real dashboard chrome with a
// content skeleton instead of a blank screen.
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoading, isError } = useMe()

  React.useEffect(() => {
    if (isError) {
      queryClient.clear()
      router.replace("/login")
    }
  }, [isError, queryClient, router])

  if (isError) return null

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return <>{children}</>
}
