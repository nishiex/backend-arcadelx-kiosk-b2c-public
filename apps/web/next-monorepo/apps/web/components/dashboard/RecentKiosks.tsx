"use client"

import React from "react"
import { Box } from "lucide-react"
import { useOwnedKiosks } from "@/hooks/useOwnedKiosks"
import { useReveal } from "@/hooks/useReveal"
import { Panel, Skeleton, ErrorState, EmptyState, StatusBadge } from "./ui"

export default function RecentKiosks() {
  const { data, isLoading, isError, refetch } = useOwnedKiosks()

  const kiosks = (data ?? []).slice(0, 8)
  const ref = useReveal<HTMLUListElement>([kiosks.length])

  return (
    <Panel
      title="Recent kiosks"
      subtitle="Latest machines added to the fleet"
    >
      {isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn't load kiosks." onRetry={() => refetch()} />
      ) : !kiosks.length ? (
        <EmptyState message="No kiosks in your inventory." icon={<Box size={28} />} />
      ) : (
        // Cap the list to roughly the Fleet-composition donut height and scroll
        // inside, so the two side-by-side cards stay the same height.
        <ul ref={ref} className="scrollbar-hide max-h-[168px] divide-y divide-border overflow-y-auto overflow-x-hidden pr-1">
          {kiosks.map((k) => {
            const holder =
              k.currentOrg && k.currentOrg.type !== "COMPANY" ? k.currentOrg.name : null
            const sub = k.assignedOrg && k.assignedOrg.id !== k.currentOrg?.id ? k.assignedOrg.name : null
            const assigned = holder ? (sub ? `${holder} → ${sub}` : holder) : "Unassigned"
            const place = typeof k.location === "string" ? k.location : null
            return (
              <li
                key={k.id}
                data-reveal
                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors first:pt-0 last:pb-0 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium">{k.machineCode}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {k.model ?? "Unknown model"}
                    {place ? ` · ${place}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={k.status} />
                  <span className="max-w-[160px] truncate text-[11px] text-muted-foreground">{assigned}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
