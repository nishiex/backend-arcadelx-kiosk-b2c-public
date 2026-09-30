"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { Box } from "lucide-react"
import { fetchInventorySummary, KIOSK_STATUSES, type KioskStatus } from "@/lib/backend-api"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"
import { Panel, Skeleton, ErrorState, EmptyState, STATUS_META } from "./ui"

type Segment = { status: KioskStatus; count: number; pct: number }

/** Donut composition ring. Each status is an arc sized by its share of the fleet. */
function Donut({ segments, total }: { segments: Segment[]; total: number }) {
  // pathLength normalizes the circle to 100 units, so we can dash directly in %.
  let offset = 0
  return (
    <div className="relative h-[168px] w-[168px] shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          strokeWidth="13"
          className="stroke-muted"
        />
        {segments.map((s) => {
          const dash = `${s.pct} ${100 - s.pct}`
          const arc = (
            <circle
              key={s.status}
              data-arc
              cx="60"
              cy="60"
              r="48"
              fill="none"
              strokeWidth="13"
              strokeLinecap="butt"
              pathLength={100}
              stroke={STATUS_META[s.status].hex}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          )
          offset += s.pct
          return arc
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
          {total}
        </span>
        <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Total kiosks
        </span>
      </div>
    </div>
  )
}

export default function InventoryBreakdown() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["inventorySummary"],
    queryFn: fetchInventorySummary,
  })

  const rootRef = React.useRef<HTMLDivElement>(null)

  const summary = data?.summary ?? {}
  const total = Object.values(summary).reduce((a, b) => a + (b || 0), 0)
  const segments: Segment[] = KIOSK_STATUSES.map((status) => ({
    status,
    count: summary[status] || 0,
    pct: total ? (summary[status] || 0) / total * 100 : 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)

  // "In field" = deployed and earning (installed share of the whole fleet).
  const inField = total ? Math.round(((summary["INSTALLED"] || 0) / total) * 100) : 0

  React.useEffect(() => {
    if (!rootRef.current || !segments.length || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-arc]",
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: EASE, stagger: 0.08 }
      )
      gsap.fromTo(
        "[data-legend-row]",
        { opacity: 0, x: 10 },
        { opacity: 1, x: 0, duration: 0.4, ease: EASE, stagger: 0.06 }
      )
    }, rootRef)
    return () => ctx.revert()
  }, [segments.length, total])

  return (
    <Panel
      title="Fleet composition"
      className="flex h-full flex-col"
      subtitle={total ? `${inField}% of your fleet is installed in the field` : undefined}
    >
      {isLoading ? (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <Skeleton className="h-[168px] w-[168px] rounded-full" />
          <div className="flex-1 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ) : isError ? (
        <ErrorState message="Couldn't load fleet composition." onRetry={() => refetch()} />
      ) : !segments.length ? (
        <EmptyState message="No kiosks in your inventory yet." icon={<Box size={28} />} />
      ) : (
        <div
          ref={rootRef}
          className="flex flex-1 flex-col items-center justify-center gap-6 sm:flex-row sm:gap-8"
        >
          <Donut segments={segments} total={total} />
          <ul className="grid w-full min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-2.5">
            {segments.map(({ status, count, pct }) => {
              const meta = STATUS_META[status]
              return (
                <li
                  key={status}
                  data-legend-row
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0"
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-sm">
                    {count}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {Math.round(pct)}%
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Panel>
  )
}
