"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useMe } from "@/hooks/useMe"

// Session gate for the dashboard. fetchMe() already single-flights a token
// refresh on 401, so `isError` here means the session is genuinely dead (the
// access token expired AND the refresh failed). When that happens we drop any
// stale cache and send the user to /login instead of leaving them on a page
// full of failed requests.
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
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return <>{children}</>
}
