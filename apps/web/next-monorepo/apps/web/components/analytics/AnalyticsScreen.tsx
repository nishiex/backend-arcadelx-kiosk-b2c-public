"use client"

import { useQuery } from "@tanstack/react-query"
import { Activity, AlertTriangle, Cpu, RefreshCw } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { fetchAnalyticsSummary } from "@/lib/backend-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

const number = new Intl.NumberFormat("en-IN")
const buttonClass = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"

export default function AnalyticsScreen() {
  const { isMasterAdmin, me, isLoading, isError } = useMe()
  const canViewAnalytics = isMasterAdmin && me?.membership?.status === "ACTIVE"
  const analytics = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: ({ signal }) => fetchAnalyticsSummary(signal),
    enabled: canViewAnalytics,
    staleTime: 30_000,
    retry: 1,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError) return <ErrorState message="Unable to verify your access. Refresh the page to try again." />
  if (!canViewAnalytics) return <EmptyState message="Analytics is available to the active Company Master Admin only." />

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">ArcadeLX · Operations</p>
          <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live event and device activity from Mothership.</p>
        </div>
        <button className={buttonClass} disabled={analytics.isFetching} onClick={() => void analytics.refetch()}>
          <RefreshCw size={16} className={analytics.isFetching ? "animate-spin" : ""} />
          {analytics.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {analytics.isPending ? (
        <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : analytics.isError ? (
        <ErrorState message={analytics.error.message} onRetry={() => void analytics.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Total events", analytics.data.total_events, <Activity key="total-events" size={18} />],
              ["Error events", analytics.data.error_events, <AlertTriangle key="error-events" size={18} />],
              ["Unique devices", analytics.data.unique_devices, <Cpu key="unique-devices" size={18} />],
            ].map(([label, value, icon]) => (
              <section key={String(label)} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
                <p className="mt-3 text-3xl font-semibold tabular-nums">{number.format(Number(value))}</p>
              </section>
            ))}
          </div>
          <Panel title="Events by category" subtitle={`Grouped by ${analytics.data.group_by}`}>
            {analytics.data.groups.length === 0 ? <EmptyState message="No analytics events are available yet." /> : (
              <div className="overflow-x-auto rounded-lg border border-border/70">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border bg-muted/40 text-left text-muted-foreground"><th className="px-3 py-3 font-medium">Category</th><th className="px-3 py-3 text-right font-medium">Events</th></tr></thead>
                  <tbody>{analytics.data.groups.map((group, index) => <tr key={index} className="border-b border-border/60 last:border-0"><td className="px-3 py-3">{String(group.category ?? group.name ?? group.group ?? "Unknown")}</td><td className="px-3 py-3 text-right tabular-nums">{number.format(Number(group.count ?? group.total ?? group.events ?? 0))}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
