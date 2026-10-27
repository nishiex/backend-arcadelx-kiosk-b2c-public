"use client"

import React from "react"
import { Activity, ArrowRight, Box } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { fetchMachineActivity } from "@/lib/backend-api"
import { orderDate } from "@/components/orders/order-display"
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "./ui"

export default function MachineActivityLog() {
  const [page, setPage] = React.useState(1)
  const query = useQuery({
    queryKey: ["machine-activity", page],
    queryFn: () => fetchMachineActivity(page, 10),
    refetchInterval: 10_000,
  })
  const activity = query.data?.activity ?? []
  const meta = query.data?.meta
  const totalPages = Math.max(meta?.totalPages ?? 1, 1)

  return (
    <Panel
      title="Machine activity"
      subtitle="Recent machines added and assigned in your network"
    >
      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
        </div>
      ) : query.isError ? (
        <ErrorState message="Couldn't load machine activity." onRetry={() => void query.refetch()} />
      ) : !activity.length ? (
        <EmptyState message="No machine activity has been recorded yet." icon={<Activity size={28} />} />
      ) : (
        <>
          <ul aria-label="Machine activity log" className="divide-y divide-border">
          {activity.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded-lg bg-muted p-2"><Box size={16} /></span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span>{item.action === "MACHINE_ADDED" ? "Machine added" : "Machine assigned"}</span>
                    <span className="font-mono">{item.machineCode}</span>
                    {item.action === "MACHINE_ASSIGNED" && <ArrowRight size={14} className="text-muted-foreground" />}
                    <span className="text-muted-foreground">{item.organization.name}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.model ?? "Unknown model"} · {orderDate(item.assignedFrom)}
                    {item.assignedBy ? ` · by ${item.assignedBy}` : ""}
                  </p>
                </div>
              </div>
              <StatusBadge status={item.status} />
            </li>
          ))}
          </ul>
          {meta && <footer className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>{meta.total} event{meta.total === 1 ? "" : "s"} · Page {page} of {totalPages}{query.isFetching && " · Updating…"}</span>
          <span className="flex gap-2">
            <button type="button" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Previous</button>
            <button type="button" disabled={page >= totalPages || query.isFetching} onClick={() => setPage(value => value + 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Next</button>
          </span>
          </footer>}
        </>
      )}
    </Panel>
  )
}
