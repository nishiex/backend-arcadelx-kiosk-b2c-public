"use client"

import React from "react"
import Link from "next/link"
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
      className="h-full"
      action={<Link href="/kiosks" className="shrink-0 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">View all</Link>}
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
        <ul
          ref={ref}
          aria-label="Recent kiosks"
          tabIndex={0}
          className="scrollbar-hide max-h-72 divide-y divide-border overflow-y-auto overflow-x-hidden rounded-md pr-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
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
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors first:pt-0 last:pb-0 hover:bg-muted/50"
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
