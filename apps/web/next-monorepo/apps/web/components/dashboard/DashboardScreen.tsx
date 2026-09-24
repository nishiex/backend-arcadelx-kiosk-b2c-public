"use client"

import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { useScrollReveal } from "@/hooks/useScrollReveal"
import DashboardWelcome from "./DashboardWelcome"
import StatGrid from "./StatGrid"
import InventoryBreakdown from "./InventoryBreakdown"
import RecentKiosks from "./RecentKiosks"

export default function DashboardScreen() {
  const router = useRouter()
  const { isError, isLoading, me } = useMe()
  const gridRef = useScrollReveal<HTMLDivElement>([isError])

  // Session invalid → bounce to login (preserve intent via ?next).
  React.useEffect(() => {
    if (isError) {
      const t = setTimeout(() => router.replace("/login?next=/"), 1200)
      return () => clearTimeout(t)
    }
  }, [isError, router])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DashboardWelcome />

      {isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle size={20} />
          <span>We couldn't verify your session. Redirecting you to sign in…</span>
          <Link
            href="/login?next=/"
            className="ml-auto rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium hover:bg-destructive/10"
          >
            Sign in now
          </Link>
        </div>
      ) : (
        <>
          {/* No-membership guard: user exists but isn't attached to an org yet. */}
          {!isLoading && me && !me.membership && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircle size={20} />
              <span>
                Your account isn't linked to an organization yet. Join one with an invite
                code to see inventory and activity.
              </span>
            </div>
          )}

          <StatGrid />

          <div ref={gridRef} className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <div data-reveal>
              <InventoryBreakdown />
            </div>
            <div data-reveal>
              <RecentKiosks />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
